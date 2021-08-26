const utils = require('./utils')
const ext = require('./bn-extensions')
const BN = require('bn.js')
// add inputs until we reach or surpass the target value (or deplete)
// worst-case: O(n)
function accumulative (utxos, inputs, outputs, feeRate, assets, txVersion, memoSize) {
  if (!utils.uintOrNull(feeRate)) return {}
  const changeOutputBytes = utils.outputBytes({})
  let memoPadding = 0
  if (memoSize) {
    memoPadding = memoSize + 5 + 8 // opreturn overhead + memo size + amount int64
  }
  let feeBytes = new BN(changeOutputBytes.toNumber() + 4)
  let bytesAccum = utils.transactionBytes(inputs, outputs)
  let inAccum = utils.sumOrNaN(inputs)
  let outAccum = utils.sumOrNaN(outputs, txVersion)
  let fee = ext.mul(feeRate, bytesAccum)
  const memBytes = new BN(memoPadding)
  bytesAccum = ext.add(bytesAccum, memBytes)
  feeBytes = ext.add(feeBytes, memBytes)
  const dustAmount = utils.dustThreshold({ type: 'BECH32' }, feeRate)
  // is already enough input?
  if (ext.gte(inAccum, ext.add(outAccum, fee))) return utils.finalize(inputs, outputs, feeRate, feeBytes)
  for (let i = 0; i < utxos.length; i++) {
    const utxo = utxos[i]
    const utxoBytes = utils.inputBytes(utxo)
    const utxoFee = ext.mul(feeRate, utxoBytes)
    const utxoValue = utils.uintOrNull(utxo.value)

    // skip detrimental input
    if (ext.gt(utxoFee, utxoValue)) {
      if (i === utxos.length - 1) {
        return { fee: ext.mul(feeRate, ext.add(bytesAccum, utxoBytes)) }
      }
      continue
    }

    bytesAccum = ext.add(bytesAccum, utxoBytes)
    inAccum = ext.add(inAccum, utxoValue)
    inputs.push(utxo)
    // if this is an asset input, we will need another output to send asset to so add dust satoshi to output and add output fee
    if (utxo.assetInfo) {
      const baseAssetID = utils.getBaseAssetID(utxo.assetInfo.assetGuid)
      outAccum = ext.add(outAccum, dustAmount)
      bytesAccum = ext.add(bytesAccum, changeOutputBytes)
      feeBytes = ext.add(feeBytes, changeOutputBytes)
      // double up to be safe
      bytesAccum = ext.add(bytesAccum, changeOutputBytes)
      feeBytes = ext.add(feeBytes, changeOutputBytes)
      // add another bech32 output for OP_RETURN overhead
      // any extra data should be optimized out later as OP_RETURN is serialized and fees are optimized
      bytesAccum = ext.add(bytesAccum, changeOutputBytes)
      feeBytes = ext.add(feeBytes, changeOutputBytes)

      if (utils.isAssetAllocationTx(txVersion) && assets && assets.has(baseAssetID)) {
        const utxoAssetObj = assets.get(baseAssetID)
        // auxfee for this asset exists add another output
        if (txVersion === utils.SYSCOIN_TX_VERSION_ALLOCATION_SEND && baseAssetID === utxo.assetInfo.assetGuid && utxoAssetObj.auxfeedetails && utxoAssetObj.auxfeedetails.auxfeeaddress && utxoAssetObj.auxfeedetails.auxfees && utxoAssetObj.auxfeedetails.auxfees.length > 0) {
          outAccum = ext.add(outAccum, dustAmount)
          bytesAccum = ext.add(bytesAccum, changeOutputBytes)
          feeBytes = ext.add(feeBytes, changeOutputBytes)
          // add another bech32 output for OP_RETURN overhead
          // any extra data should be optimized out later as OP_RETURN is serialized and fees are optimized
          bytesAccum = ext.add(bytesAccum, changeOutputBytes)
          feeBytes = ext.add(feeBytes, changeOutputBytes)
        }
        // add bytes and fees for notary signature
        if (utxoAssetObj.notarykeyid && utxoAssetObj.notarykeyid.length > 0) {
          const sigBytes = new BN(65)
          bytesAccum = ext.add(bytesAccum, sigBytes)
          feeBytes = ext.add(feeBytes, sigBytes)
        }
      }
    }

    fee = ext.mul(feeRate, bytesAccum)
    // go again?
    if (ext.lt(inAccum, ext.add(outAccum, fee))) continue
    return utils.finalize(inputs, outputs, feeRate, feeBytes)
  }

  return { fee: ext.mul(feeRate, bytesAccum) }
}

// worst-case: O(n)
function accumulativeAsset (utxoAssets, assetMap, feeRate, txVersion, assets) {
  if (!utils.uintOrNull(feeRate)) return {}
  const isAsset = utils.isAsset(txVersion)
  const isNonAssetFunded = utils.isNonAssetFunded(txVersion)
  const dustAmount = utils.dustThreshold({ type: 'BECH32' }, feeRate)
  const assetAllocations = []
  const outputs = []
  const inputs = []
  let auxfeeValue = ext.BN_ZERO
  // loop through all assets looking to get funded, sort the utxo's and then try to fund them incrementally
  for (const [assetGuid, valueAssetObj] of assetMap.entries()) {
    const baseAssetID = utils.getBaseAssetID(assetGuid)
    const utxoAssetObj = (assets && assets.get(baseAssetID)) || {}
    const assetAllocation = { assetGuid: assetGuid, values: [], notarysig: utxoAssetObj.notarysig || Buffer.from('') }
    if (!isAsset) {
      // auxfee is set and its an allocation send and its not an NFT
      if (txVersion === utils.SYSCOIN_TX_VERSION_ALLOCATION_SEND && baseAssetID === assetGuid && utxoAssetObj.auxfeedetails && utxoAssetObj.auxfeedetails.auxfeeaddress && utxoAssetObj.auxfeedetails.auxfees && utxoAssetObj.auxfeedetails.auxfees.length > 0) {
        let totalAssetValue = ext.BN_ZERO
        // find total amount for this asset from assetMap
        valueAssetObj.outputs.forEach(output => {
          totalAssetValue = ext.add(totalAssetValue, output.value)
        })
        // get auxfee based on auxfee table and total amount sending
        auxfeeValue = utils.getAuxFee(utxoAssetObj.auxfeedetails, totalAssetValue)
        if (auxfeeValue.gt(ext.BN_ZERO)) {
          assetAllocation.values.push({ n: outputs.length, value: auxfeeValue })
          outputs.push({ address: utxoAssetObj.auxfeedetails.auxfeeaddress, type: 'BECH32', assetInfo: { assetGuid: assetGuid, value: auxfeeValue }, value: dustAmount })
        }
      }
    }
    valueAssetObj.outputs.forEach(output => {
      assetAllocation.values.push({ n: outputs.length, value: output.value })
      if (output.address === valueAssetObj.changeAddress) {
        // add change index
        outputs.push({ assetChangeIndex: assetAllocation.values.length - 1, type: 'BECH32', assetInfo: { assetGuid: assetGuid, value: output.value }, value: dustAmount })
      } else {
        outputs.push({ address: output.address, type: 'BECH32', assetInfo: { assetGuid: assetGuid, value: output.value }, value: dustAmount })
      }
    })
    const hasZeroVal = utils.hasZeroVal(valueAssetObj.outputs)
    let assetOutAccum = isAsset ? ext.BN_ZERO : utils.sumOrNaN(valueAssetObj.outputs)
    // if auxfee exists add total output for asset with auxfee so change is calculated properly
    if (!ext.eq(auxfeeValue, ext.BN_ZERO)) {
      assetOutAccum = ext.add(assetOutAccum, auxfeeValue)
    }
    // order by descending asset amounts for this asset guid
    let utxoAsset = utxoAssets.filter(utxo => utxo.assetInfo.assetGuid === assetGuid)
    utxoAsset = utxoAsset.concat().sort(function (a, b) {
      return ext.sub(b.assetInfo.value, a.assetInfo.value)
    })
    let funded = txVersion === utils.SYSCOIN_TX_VERSION_ASSET_ACTIVATE
    // look for zero val input if zero val output exists
    if (hasZeroVal && !funded) {
      let foundZeroVal = false
      for (let i = utxoAsset.length - 1; i >= 0; i--) {
        const utxo = utxoAsset[i]
        const utxoValue = utils.uintOrNull(utxo.assetInfo.value)
        if (!utxoValue.isZero()) {
          continue
        }
        inputs.push(utxo)
        foundZeroVal = true
        // if requested output was 0 then we should be done
        if (assetOutAccum.isZero()) {
          funded = true
        }
        break
      }
      if (!foundZeroVal) {
        return utils.finalizeAssets(null, null, null, null, null)
      }
    }

    if (!funded && !isNonAssetFunded) {
      // order by descending asset amounts for this asset guid
      let utxoAsset = utxoAssets.filter(utxo => utxo.assetInfo.assetGuid === assetGuid)
      utxoAsset = utxoAsset.concat().sort(function (a, b) {
        return ext.sub(b.assetInfo.value, a.assetInfo.value)
      })
      let inAccum = ext.BN_ZERO
      for (let i = 0; i < utxoAsset.length; i++) {
        const utxo = utxoAsset[i]
        const utxoValue = utils.uintOrNull(utxo.assetInfo.value)
        // if not funding asset new/update/send, we should fund with non-zero asset utxo amounts only
        if (!hasZeroVal && utxoValue.isZero()) {
          continue
        }
        inAccum = ext.add(inAccum, utxoValue)
        inputs.push(utxo)
        // deal with change
        if (ext.gt(inAccum, assetOutAccum)) {
          const changeAsset = ext.sub(inAccum, assetOutAccum)
          // add output as dust amount (smallest possible sys output)
          const output = { assetChangeIndex: assetAllocation.values.length, type: 'BECH32', assetInfo: { assetGuid: assetGuid, value: changeAsset }, value: dustAmount }
          // but asset commitment will have the full asset change value
          assetAllocation.values.push({ n: outputs.length, value: changeAsset })
          outputs.push(output)
          break
        // no change, in = out
        } else if (ext.eq(inAccum, assetOutAccum)) {
          break
        }
      }
    }
    assetAllocations.push(assetAllocation)
  }
  return utils.finalizeAssets(inputs, outputs, assetAllocations)
}

module.exports = {
  accumulative: accumulative,
  accumulativeAsset: accumulativeAsset
}
