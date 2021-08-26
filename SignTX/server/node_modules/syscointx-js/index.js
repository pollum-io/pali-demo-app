const BN = require('bn.js')
const ext = require('./bn-extensions')
const utils = require('./utils')
const syscoinBufferUtils = require('./bufferutilsassets.js')
const bitcoin = require('bitcoinjs-lib')
const coinSelect = require('coinselectsyscoin')
const bitcoinops = require('bitcoin-ops')
const _ = require('lodash')

function createTransaction (txOpts, utxos, changeAddress, outputsArr, feeRate) {
  let dataBuffer = null
  let totalMemoLen = 0
  if (txOpts.memo) {
    if (!txOpts.memoHeader) {
      console.log('No Memo header defined')
      return null
    }
    totalMemoLen = txOpts.memo.length + txOpts.memoHeader.length
  }
  if (totalMemoLen > 80) {
    console.log('Memo too big! Max is 80 bytes, found: ' + totalMemoLen)
    return null
  }
  if (txOpts.memo) {
    dataBuffer = Buffer.concat([txOpts.memoHeader, txOpts.memo])
  }
  let txVersion = 2
  const inputsArr = []
  let res = coinSelect.coinSelect(utxos.utxos, inputsArr, outputsArr, feeRate, utxos.assets, txVersion, totalMemoLen)
  if (!res.inputs || !res.outputs) {
    const assetAllocations = []
    console.log('createTransaction: inputs or outputs are empty after coinSelect trying to fund with Syscoin Asset inputs...')
    res = coinSelect.coinSelectAssetGas(assetAllocations, utxos.utxos, inputsArr, outputsArr, feeRate, utils.SYSCOIN_TX_VERSION_ALLOCATION_SEND, utxos.assets, null, totalMemoLen)
    if (!res.inputs || !res.outputs) {
      console.log('createTransaction: inputs or outputs are empty after coinSelectAssetGas')
      return null
    }
    if (assetAllocations.length > 0) {
      txVersion = utils.SYSCOIN_TX_VERSION_ALLOCATION_SEND
      // re-use syscoin change outputs for allocation change outputs where we can, this will possible remove one output and save fees
      optimizeOutputs(res.outputs, assetAllocations)
      const assetAllocationsBuffer = syscoinBufferUtils.serializeAssetAllocations(assetAllocations)
      let buffArr
      if (dataBuffer) {
        buffArr = [assetAllocationsBuffer, dataBuffer]
      } else {
        buffArr = [assetAllocationsBuffer]
      }
      // create and add data script for OP_RETURN
      const dataScript = bitcoin.payments.embed({ data: [Buffer.concat(buffArr)] }).output
      const dataOutput = {
        script: dataScript,
        value: ext.BN_ZERO
      }
      res.outputs.push(dataOutput)
      let bOverrideRBF = false
      assetAllocations.forEach(assetAllocation => {
        const assetObj = utxos.assets.get(coinSelect.utils.getBaseAssetID(assetAllocation.assetGuid))
        if (assetObj && assetObj.notarydetails && assetObj.notarydetails.instanttransfers) {
          bOverrideRBF = true
        }
      })
      // if rbf not set but one asset was notarized turn on rbf
      if (bOverrideRBF && txOpts.rbf !== true) {
        console.log('override RBF settings due to notary with instant transfers enabled')
        txOpts.rbf = true
      }
    }
  } else if (dataBuffer) {
    const updatedData = [dataBuffer]
    const dataScript = bitcoin.payments.embed({ data: [Buffer.concat(updatedData)] }).output
    const dataOutput = {
      script: dataScript,
      value: ext.BN_ZERO
    }
    res.outputs.push(dataOutput)
  }
  const inputs = res.inputs
  const outputs = res.outputs

  optimizeFees(txVersion, inputs, outputs, feeRate)
  if (txVersion === utils.SYSCOIN_TX_VERSION_ALLOCATION_SEND) {
    // ensure ZDAG is only enable for transactions <= 1100 bytes
    const bytesAccum = coinSelect.utils.transactionBytes(inputs, outputs)
    // if size too large we ensure ZDAG isn't set by enabling RBF (disable ZDAG)
    if (bytesAccum > 1100) {
      if (!txOpts.rbf) {
        txOpts.rbf = true
      }
    }
  }
  if (txOpts.rbf) {
    inputs.forEach(input => {
      input.sequence = utils.MAX_BIP125_RBF_SEQUENCE
    })
  }
  outputs.forEach(output => {
    // watch out, outputs may have been added that you need to provide
    // an output address/script for
    if (!output.address) {
      output.address = changeAddress
    }
  })
  return { txVersion, inputs, outputs }
}
// update all allocations at some index or higher
function updateAllocationIndexes (assetAllocations, index) {
  assetAllocations.forEach(voutAsset => {
    voutAsset.values.forEach(output => {
      if (output.n > index) {
        output.n--
      }
    })
  })
}

function optimizeOutputs (outputs, assetAllocations) {
  // first find all syscoin outputs that are change (should only be one)
  const changeOutputs = outputs.filter(output => output.changeIndex !== undefined)
  if (changeOutputs.length > 1) {
    console.log('optimizeOutputs: too many change outputs')
    return
  }
  // find all asset change outputs
  const assetChangeOutputs = outputs.filter(assetOutput => assetOutput.assetChangeIndex !== undefined && assetOutput.assetInfo.assetGuid > 0)
  changeOutputs.forEach(output => {
    // for every asset output and find any where the allocation index and change output index don't match
    // make the allocation point to the syscoin change output and we can delete the asset output (it sends dust anyway)
    for (let i = 0; i < assetChangeOutputs.length; i++) {
      const assetOutput = assetChangeOutputs[i]
      // get the allocation by looking up from assetChangeIndex which is indexing into the allocations array for this asset guid
      const allocations = assetAllocations.find(voutAsset => voutAsset.assetGuid === assetOutput.assetInfo.assetGuid)
      const allocation = allocations.values[assetOutput.assetChangeIndex]
      // ensure that the output index's don't match between sys change and asset output
      if (allocation.n !== output.changeIndex) {
        // remove the output, we will recalc and optimize fees after this call
        outputs.splice(allocation.n, 1)

        // because we deleted this index, it will invalidate any indexes after (we must subtract by one on every index after assetChangeIndex)
        updateAllocationIndexes(assetAllocations, allocation.n)
        // set them the same and remove asset output
        // we reduce index by one because any index > allocation.n would have been reduced by updateAllocationIndexes and so changeIndex should also by reduced by 1 if its above allocation.n
        if (output.changeIndex > allocation.n) {
          allocation.n = output.changeIndex - 1
        } else {
          allocation.n = output.changeIndex
        }
        // add assetInfo to output as its a sys change output which now becomes asset output as well (only needed for further calls which check assetInfo on outputs, not for signing or verifying the transaction)
        outputs[allocation.n].assetInfo = assetOutput.assetInfo
        // clear change address as it should use sys change address instead (when adding outputs)
        allocation.changeAddress = null
        return
      }
    }
  })
}

function optimizeFees (txVersion, inputs, outputs, feeRate) {
  const changeOutputs = outputs.filter(output => output.changeIndex !== undefined)
  if (changeOutputs.length > 1) {
    console.log('optimizeFees: too many change outputs')
    return
  }
  if (changeOutputs.length === 0) {
    console.log('optimizeFees: no change outputs')
    return
  }
  const changeOutput = changeOutputs[0]
  const bytesAccum = coinSelect.utils.transactionBytes(inputs, outputs)
  const feeRequired = ext.mul(feeRate, bytesAccum)
  let feeFoundInOut = ext.sub(coinSelect.utils.sumOrNaN(inputs), coinSelect.utils.sumOrNaN(outputs))
  // first output of burn to sys is not accounted for with inputs, its minted based on sysx asset output to burn
  if (txVersion === utils.SYSCOIN_TX_VERSION_ALLOCATION_BURN_TO_SYSCOIN) {
    feeFoundInOut = ext.add(feeFoundInOut, outputs[0].value)
  }
  if (feeFoundInOut && ext.gt(feeFoundInOut, feeRequired)) {
    const reduceFee = ext.sub(feeFoundInOut, feeRequired)
    console.log('optimizeFees: reducing fees by: ' + reduceFee.toNumber())
    // add to change to effectively reduce fee
    changeOutput.value = ext.add(changeOutput.value, reduceFee)
  } else if (ext.lt(feeFoundInOut, feeRequired)) {
    console.log('optimizeFees: warning, not enough fees found in transaction: required: ' + feeRequired.toNumber() + ' found: ' + feeFoundInOut.toNumber())
  }
}

// update all notarizations stored in assets map (as notarysig field) into re-serialized output scripts
function addNotarizationSignatures (txVersion, assets, outputs) {
  if (!utils.isAssetAllocationTx(txVersion)) {
    return { output: null, index: -1 }
  }
  // if no sigs then just return, not applicable to notarizing
  if (assets.size === 0) {
    return { output: null, index: -1 }
  }
  let opReturnScript = null
  let dataScript = null
  let opReturnIndex = 0
  for (let i = 0; i < outputs.length; i++) {
    const output = outputs[i]
    if (!output.script) {
      continue
    }
    // find opreturn
    const chunks = bitcoin.script.decompile(output.script)
    if (chunks[0] === bitcoinops.OP_RETURN) {
      opReturnScript = chunks[1]
      opReturnIndex = i
      break
    }
  }

  if (opReturnScript === null) {
    console.log('no OPRETURN script found')
    return { output: null, index: -1 }
  }
  const extractMemoFromScript = true
  if (txVersion === utils.SYSCOIN_TX_VERSION_ALLOCATION_BURN_TO_ETHEREUM || txVersion === utils.SYSCOIN_TX_VERSION_ALLOCATION_BURN_TO_SYSCOIN) {
    const allocationBurn = syscoinBufferUtils.deserializeAllocationBurn(opReturnScript, extractMemoFromScript)
    let assetAllocation = null
    for (const [assetGuid, valueAssetObj] of assets.entries()) {
      if (valueAssetObj.notarysig) {
        assetAllocation = allocationBurn.allocation.find(voutAsset => coinSelect.utils.getBaseAssetID(voutAsset.assetGuid) === assetGuid)
        if (assetAllocation) {
          assetAllocation.notarysig = valueAssetObj.notarysig
        }
      }
    }
    const assetAllocationsBuffer = syscoinBufferUtils.serializeAssetAllocations(allocationBurn.allocation)
    const allocationBurnBuffer = syscoinBufferUtils.serializeAllocationBurn(allocationBurn)
    let buffArr
    if (allocationBurn.allocation.memo) {
      buffArr = [assetAllocationsBuffer, allocationBurnBuffer, allocationBurn.allocation.memo]
    } else {
      buffArr = [assetAllocationsBuffer, allocationBurnBuffer]
    }
    if (assetAllocation !== undefined) {
      dataScript = bitcoin.payments.embed({ data: [Buffer.concat(buffArr)] }).output
    }
  } else if (txVersion === utils.SYSCOIN_TX_VERSION_ALLOCATION_SEND || txVersion === utils.SYSCOIN_TX_VERSION_SYSCOIN_BURN_TO_ALLOCATION) {
    const allocation = syscoinBufferUtils.deserializeAssetAllocations(opReturnScript, null, extractMemoFromScript)
    let assetAllocation = null
    for (const [assetGuid, valueAssetObj] of assets.entries()) {
      if (valueAssetObj.notarysig) {
        assetAllocation = allocation.find(voutAsset => coinSelect.utils.getBaseAssetID(voutAsset.assetGuid) === assetGuid)
        if (assetAllocation) {
          assetAllocation.notarysig = valueAssetObj.notarysig
        }
      }
    }
    const assetAllocationsBuffer = syscoinBufferUtils.serializeAssetAllocations(allocation)
    let buffArr
    if (allocation.memo) {
      buffArr = [assetAllocationsBuffer, allocation.memo]
    } else {
      buffArr = [assetAllocationsBuffer]
    }
    if (assetAllocation !== undefined) {
      dataScript = bitcoin.payments.embed({ data: [Buffer.concat(buffArr)] }).output
    }
  }
  return { output: dataScript, index: opReturnIndex }
}
// from assets map create the JSON output to send back to client from a notary server
function createNotarizationOutput (assets) {
  const jsonOut = []
  for (const [assetGuid, valueAssetObj] of assets.entries()) {
    if (valueAssetObj.notarysig) {
      jsonOut.push({ asset: assetGuid, sig: valueAssetObj.notarysig.toString('base64') })
    }
  }
  return jsonOut
}

function getAllocationsFromOutputs (outputs) {
  let opReturnScript = null
  for (let i = 0; i < outputs.length; i++) {
    const output = outputs[i]
    if (!output.script) {
      continue
    }
    // find opreturn
    const chunks = bitcoin.script.decompile(output.script)
    if (chunks[0] === bitcoinops.OP_RETURN) {
      opReturnScript = chunks[1]
      break
    }
  }

  if (opReturnScript === null) {
    console.log('no OPRETURN script found')
    return null
  }

  const allocation = syscoinBufferUtils.deserializeAssetAllocations(opReturnScript)
  if (!allocation) {
    return null
  }
  return allocation
}

function getAllocationsFromTx (tx) {
  if (!utils.isSyscoinTx(tx.version)) {
    return null
  }
  return getAllocationsFromOutputs(tx.outs)
}

function getAssetsFromOutputs (outputs) {
  const allocation = getAllocationsFromOutputs(outputs)
  if (!allocation) {
    return null
  }
  const assets = new Map()
  allocation.forEach(assetAllocation => {
    assets.set(coinSelect.utils.getBaseAssetID(assetAllocation.assetGuid), {})
  })
  return assets
}

// get all assets found in an asset tx returned in a map of assets keyed by asset guid
function getAssetsFromTx (tx) {
  const allocation = getAllocationsFromTx(tx)
  if (!allocation) {
    return null
  }
  const assets = new Map()
  allocation.forEach(assetAllocation => {
    assets.set(coinSelect.utils.getBaseAssetID(assetAllocation.assetGuid), {})
  })
  return assets
}
// get all notarizations stored of assets in assets map as notarysighash stored in assets
function fillNotarizationSigHash (tx, assets, network) {
  const allocation = getAllocationsFromTx(tx)
  if (!allocation) {
    return false
  }
  let filledNotarySigHash = false
  for (const [assetGuid, valueAssetObj] of assets.entries()) {
    const assetAllocation = allocation.find(voutAsset => coinSelect.utils.getBaseAssetID(voutAsset.assetGuid) === assetGuid)
    if (assetAllocation) {
      valueAssetObj.notarysighash = syscoinBufferUtils.fillNotarizationSigHash(tx, assetAllocation, network)
      filledNotarySigHash = true
    }
  }
  return filledNotarySigHash
}
// sign all notary sig hashes with WIF
function signAndFillNotarizationSigHashesWithWIF (assets, WIF, network) {
  let signedNotary = false
  for (const value of assets.values()) {
    if (value.notarysighash) {
      try {
        const sig = utils.signHash(WIF, value.notarysighash, network)
        if (sig) {
          value.notarysig = sig
          signedNotary = true
        }
      } catch (exception) {
        console.log('Could not sign notarysighash ' + exception)
        continue
      }
    }
  }
  return signedNotary
}
function createAssetTransaction (txVersion, txOpts, utxos, dataBuffer, dataAmount, assetMap, sysChangeAddress, feeRate) {
  let { inputs, outputs, assetAllocations } = coinSelect.coinSelectAsset(utxos.utxos, assetMap, feeRate, txVersion, utxos.assets)

  // .inputs and .outputs will be undefined if no solution was found
  if (!inputs || !outputs) {
    console.log('createAssetTransaction: inputs or outputs are empty after coinSelectAsset')
    return null
  }

  let burnAllocationValue
  if (utils.isAllocationBurn(txVersion)) {
    // ensure only 1 to 2 outputs (2 if change was required)
    if (outputs.length > 2 && outputs.length < 1) {
      console.log('Assetallocationburn: expect output of length 1 got: ' + outputs.length)
      return null
    }
    const assetAllocation = assetAllocations.find(voutAsset => voutAsset.assetGuid === outputs[0].assetInfo.assetGuid)
    if (assetAllocation === undefined) {
      console.log('Assetallocationburn: assetAllocations map does not have key: ' + outputs[0].assetInfo.assetGuid)
      return null
    }
    burnAllocationValue = new BN(assetAllocation.values[0].value)
    if (txVersion === utils.SYSCOIN_TX_VERSION_ALLOCATION_BURN_TO_ETHEREUM) {
      outputs.splice(0, 1)
      // we removed the first index via slice above, so all N's at index 1 or above should be reduced by 1
      updateAllocationIndexes(assetAllocations, 0)
    }
    // point first allocation to next output (burn output)
    assetAllocation.values[0].n = outputs.length
  }

  let assetAllocationsBuffer = syscoinBufferUtils.serializeAssetAllocations(assetAllocations)
  let buffArr
  if (dataBuffer) {
    buffArr = [assetAllocationsBuffer, dataBuffer]
  } else {
    buffArr = [assetAllocationsBuffer]
  }
  // create and add data script for OP_RETURN
  let dataScript = bitcoin.payments.embed({ data: [Buffer.concat(buffArr)] }).output
  const dataOutput = {
    script: dataScript,
    value: dataAmount
  }
  outputs.push(dataOutput)
  const res = coinSelect.coinSelectAssetGas(assetAllocations, utxos.utxos, inputs, outputs, feeRate, txVersion, utxos.assets, assetMap)
  if (!res.inputs || !res.outputs) {
    console.log('createAssetTransaction: inputs or outputs are empty after coinSelectAssetGas')
    return null
  }
  inputs = res.inputs
  outputs = res.outputs
  // once funded we should swap the first output asset amount to sys amount as we are burning sysx to sys in output 0
  if (utils.isAllocationBurn(txVersion)) {
    if (txVersion === utils.SYSCOIN_TX_VERSION_ALLOCATION_BURN_TO_SYSCOIN) {
      // modify output from asset value to syscoin value
      // first output is special it is the sys amount being minted
      outputs[0].value = burnAllocationValue
    }
  } else if (txVersion === utils.SYSCOIN_TX_VERSION_ASSET_ACTIVATE) {
    assetAllocations[0].assetGuid = txOpts.assetGuid || utils.generateAssetGuid(inputs[0])
    const assetOutput = outputs.filter(output => output.assetInfo && output.assetInfo.assetGuid === '0')
    if (assetOutput.length !== 1) {
      console.log('createAssetTransaction: invalid number of asset outputs for activate')
      return null
    }
    // update outputs
    assetOutput[0].assetInfo.assetGuid = assetAllocations[0].assetGuid
    // update assetMap with new key
    const oldAssetMapEntry = assetMap.get('0')
    assetMap.delete('0')
    assetMap.set(assetAllocations[0].assetGuid, oldAssetMapEntry)
  }

  // re-use syscoin change outputs for allocation change outputs where we can, this will possible remove one output and save fees
  optimizeOutputs(outputs, assetAllocations)

  // serialize allocations again they may have been changed in optimization
  assetAllocationsBuffer = syscoinBufferUtils.serializeAssetAllocations(assetAllocations)
  if (dataBuffer) {
    buffArr = [assetAllocationsBuffer, dataBuffer]
  } else {
    buffArr = [assetAllocationsBuffer]
  }
  // update script with new guid
  dataScript = bitcoin.payments.embed({ data: [Buffer.concat(buffArr)] }).output
  // update output with new data output with new guid
  outputs.forEach(output => {
    if (output.script) {
      output.script = dataScript
    }
  })

  optimizeFees(txVersion, inputs, outputs, feeRate)
  if (utxos.assets) {
    let bOverrideRBF = false
    assetAllocations.forEach(assetAllocation => {
      const assetObj = utxos.assets.get(coinSelect.utils.getBaseAssetID(assetAllocation.assetGuid))
      if (assetObj && assetObj.notarydetails && assetObj.notarydetails.instanttransfers) {
        bOverrideRBF = true
      }
    })
    // if rbf not set but one asset was notarized turn on rbf
    if (bOverrideRBF && txOpts.rbf !== true) {
      console.log('override RBF settings due to notary with instant transfers enabled')
      txOpts.rbf = true
    }
  }
  // asset activates not allowed to use RBF because of deterministic asset GUID requirements based on input hash
  if (txVersion === utils.SYSCOIN_TX_VERSION_ASSET_ACTIVATE) {
    txOpts.rbf = false
  }

  if (txVersion === utils.SYSCOIN_TX_VERSION_ALLOCATION_SEND) {
    // ensure ZDAG is only enable for transactions <= 1100 bytes
    const bytesAccum = coinSelect.utils.transactionBytes(inputs, outputs)
    // if size too large we ensure ZDAG isn't set by enabling RBF (disable ZDAG)
    if (bytesAccum > 1100) {
      if (!txOpts.rbf) {
        txOpts.rbf = true
      }
    }
  }
  if (txOpts.rbf) {
    inputs.forEach(input => {
      input.sequence = utils.MAX_BIP125_RBF_SEQUENCE
    })
  }
  outputs.forEach(output => {
    // watch out, outputs may have been added that you need to provide
    // an output address/script for
    if (!output.address) {
      if (output.assetInfo) {
        if (assetMap.has(output.assetInfo.assetGuid)) {
          const changeAddress = assetMap.get(output.assetInfo.assetGuid).changeAddress
          if (changeAddress) {
            output.address = changeAddress
          }
        }
      }
    }
    // if we still don't have address set to sys change address
    if (!output.address) {
      output.address = sysChangeAddress
    }
  })
  return { txVersion, inputs, outputs }
}
function assetNew (assetOpts, txOpts, utxos, assetMap, sysChangeAddress, feeRate) {
  const txVersion = utils.SYSCOIN_TX_VERSION_ASSET_ACTIVATE
  const dataAmount = new BN(utils.COIN)
  assetOpts.contract = assetOpts.contract || Buffer.from('')
  if (assetOpts.description) {
    assetOpts.pubdata = utils.encodePubDataFromFields({ desc: assetOpts.description })
  } else {
    assetOpts.pubdata = Buffer.from('')
  }
  const defaultNotarydetails = { endpoint: Buffer.from(''), instanttransfers: 0, hdrequired: 0 }
  const defaultAuxfeedetails = { auxfeekeyid: Buffer.from(''), auxfees: [] }
  assetOpts.symbol = Buffer.from(utils.encodeToBase64(assetOpts.symbol))
  assetOpts.description = null
  assetOpts.prevcontract = Buffer.from('')
  assetOpts.prevpubdata = Buffer.from('')
  assetOpts.notarykeyid = assetOpts.notarykeyid || Buffer.from('')
  assetOpts.prevnotarykeyid = Buffer.from('')
  assetOpts.notarydetails = assetOpts.notarydetails || defaultNotarydetails
  assetOpts.prevnotarydetails = { endpoint: Buffer.from(''), instanttransfers: 0, hdrequired: 0 }
  assetOpts.auxfeedetails = assetOpts.auxfeedetails || defaultAuxfeedetails
  assetOpts.prevauxfeedetails = { auxfeekeyid: Buffer.from(''), auxfees: [] }
  assetOpts.updatecapabilityflags = assetOpts.updatecapabilityflags || utils.ASSET_CAPABILITY_ALL
  assetOpts.prevupdatecapabilityflags = 0
  assetOpts.totalsupply = ext.BN_ZERO

  let updateflags = utils.ASSET_INIT
  if (assetOpts.contract.length > 0) {
    updateflags = updateflags | utils.ASSET_UPDATE_CONTRACT
  }
  if (assetOpts.pubdata.length > 0) {
    updateflags = updateflags | utils.ASSET_UPDATE_DATA
  }
  if (assetOpts.notarykeyid.length > 0) {
    updateflags = updateflags | utils.ASSET_UPDATE_NOTARY_KEY
  }
  if (!_.isEqual(assetOpts.notarydetails, defaultNotarydetails)) {
    updateflags = updateflags | utils.ASSET_UPDATE_NOTARY_DETAILS
  }
  if (!_.isEqual(assetOpts.auxfeedetails, defaultAuxfeedetails)) {
    updateflags = updateflags | utils.ASSET_UPDATE_AUXFEE
  }
  if (assetOpts.updatecapabilityflags !== 0) {
    updateflags = updateflags | utils.ASSET_UPDATE_CAPABILITYFLAGS
  }
  assetOpts.updateflags = updateflags

  const dataBuffer = syscoinBufferUtils.serializeAsset(assetOpts)
  return createAssetTransaction(txVersion, txOpts, utxos, dataBuffer, dataAmount, assetMap, sysChangeAddress, feeRate)
}

function assetUpdate (assetGuid, assetOpts, txOpts, utxos, assetMap, sysChangeAddress, feeRate) {
  if (!utxos.assets.has(assetGuid)) {
    console.log('Asset input not found in UTXO set passed in')
    return null
  }
  const assetObj = utxos.assets.get(assetGuid)
  const txVersion = utils.SYSCOIN_TX_VERSION_ASSET_UPDATE
  const dataAmount = ext.BN_ZERO
  assetOpts.precision = assetObj.precision
  assetOpts.symbol = Buffer.from('')
  assetOpts.contract = assetOpts.contract || assetObj.contract
  if (assetOpts.description) {
    assetOpts.pubdata = utils.encodePubDataFromFields({ desc: assetOpts.description })
  } else {
    assetOpts.pubdata = assetObj.pubdata
  }
  assetOpts.notarykeyid = assetOpts.notarykeyid || assetObj.notarykeyid
  assetOpts.notarydetails = assetOpts.notarydetails || assetObj.notarydetails
  assetOpts.auxfeekeyid = assetOpts.auxfeekeyid || assetObj.auxfeekeyid
  assetOpts.auxfeedetails = assetOpts.auxfeedetails || assetObj.auxfeedetails
  assetOpts.updatecapabilityflags = assetOpts.updatecapabilityflags || assetObj.updatecapabilityflags
  let updateflags = 0
  // if fields that can be edited are the same we clear them so they aren't updated and we reduce tx payload
  if (!_.isEqual(assetObj.contract, assetOpts.contract)) {
    assetOpts.prevcontract = assetObj.contract || Buffer.from('')
    updateflags = updateflags | utils.ASSET_UPDATE_CONTRACT
  }
  if (!_.isEqual(assetObj.pubdata, assetOpts.pubdata)) {
    assetOpts.prevpubdata = assetObj.pubdata || Buffer.from('')
    updateflags = updateflags | utils.ASSET_UPDATE_DATA
  }
  if (!_.isEqual(assetObj.updatecapabilityflags, assetOpts.updatecapabilityflags)) {
    assetOpts.prevupdatecapabilityflags = assetObj.updatecapabilityflags
    updateflags = updateflags | utils.ASSET_UPDATE_CAPABILITYFLAGS
  }
  if (!_.isEqual(assetObj.notarykeyid, assetOpts.notarykeyid)) {
    assetOpts.prevnotarykeyid = assetObj.notarykeyid || Buffer.from('')
    updateflags = updateflags | utils.ASSET_UPDATE_NOTARY_KEY
  }
  if (!_.isEqual(assetObj.notarydetails, assetOpts.notarydetails)) {
    assetOpts.prevnotarydetails = assetObj.notarydetails || { endpoint: Buffer.from(''), instanttransfers: 0, hdrequired: 0 }
    updateflags = updateflags | utils.ASSET_UPDATE_NOTARY_DETAILS
  }
  if (!_.isEqual(assetObj.auxfeedetails, assetOpts.auxfeedetails)) {
    assetOpts.prevauxfeedetails = assetObj.auxfeedetails || { auxfeekeyid: Buffer.from(''), auxfees: [] }
    updateflags = updateflags | utils.ASSET_UPDATE_AUXFEE
  }
  assetOpts.updateflags = updateflags
  const dataBuffer = syscoinBufferUtils.serializeAsset(assetOpts)
  return createAssetTransaction(txVersion, txOpts, utxos, dataBuffer, dataAmount, assetMap, sysChangeAddress, feeRate)
}
function assetSend (txOpts, utxos, assetMap, sysChangeAddress, feeRate) {
  const txVersion = utils.SYSCOIN_TX_VERSION_ASSET_SEND
  const dataAmount = ext.BN_ZERO
  const dataBuffer = null
  return createAssetTransaction(txVersion, txOpts, utxos, dataBuffer, dataAmount, assetMap, sysChangeAddress, feeRate)
}

function assetAllocationSend (txOpts, utxos, assetMap, sysChangeAddress, feeRate) {
  const txVersion = utils.SYSCOIN_TX_VERSION_ALLOCATION_SEND
  const dataAmount = ext.BN_ZERO
  let dataBuffer = null
  if (txOpts.memo) {
    if (!Buffer.isBuffer(txOpts.memo)) {
      console.log('Memo must be Buffer object')
      return
    }
    const totalLen = txOpts.memo.length + txOpts.memoHeader.length
    if (!txOpts.memoHeader) {
      console.log('No Memo header defined')
      return
    }
    if (totalLen > 80) {
      console.log('Memo too big! Max is 80 bytes, found: ' + totalLen)
      return
    }
    dataBuffer = Buffer.concat([txOpts.memoHeader, txOpts.memo])
  }
  return createAssetTransaction(txVersion, txOpts, utxos, dataBuffer, dataAmount, assetMap, sysChangeAddress, feeRate)
}

function assetAllocationBurn (assetOpts, txOpts, utxos, assetMap, sysChangeAddress, feeRate) {
  let txVersion = 0
  if (assetOpts.ethaddress.length > 0) {
    txVersion = utils.SYSCOIN_TX_VERSION_ALLOCATION_BURN_TO_ETHEREUM
  } else {
    txVersion = utils.SYSCOIN_TX_VERSION_ALLOCATION_BURN_TO_SYSCOIN
  }
  const dataAmount = ext.BN_ZERO
  const dataBuffer = syscoinBufferUtils.serializeAllocationBurn(assetOpts)
  return createAssetTransaction(txVersion, txOpts, utxos, dataBuffer, dataAmount, assetMap, sysChangeAddress, feeRate)
}

function assetAllocationMint (assetOpts, txOpts, utxos, assetMap, sysChangeAddress, feeRate) {
  const txVersion = utils.SYSCOIN_TX_VERSION_ALLOCATION_MINT
  const dataAmount = ext.BN_ZERO
  if (assetOpts.txparentnodes.length > utils.USHRT_MAX()) {
    console.log('tx parent nodes exceeds maximum allowable size of: ', utils.USHRT_MAX(), '. Found size: ', assetOpts.txparentnodes.length)
    return
  }
  if (assetOpts.receiptparentnodes.length > utils.USHRT_MAX()) {
    console.log('receipt parent nodes exceeds maximum allowable size of: ', utils.USHRT_MAX(), '. Found size: ', assetOpts.receiptparentnodes.length)
    return
  }
  // find byte offset of tx data in the parent nodes
  assetOpts.txpos = assetOpts.txparentnodes.indexOf(assetOpts.txvalue)
  if (assetOpts.txpos === -1) {
    console.log('Could not find tx value in tx parent nodes')
    return
  }
  // find byte offset of receipt data in the parent nodes
  assetOpts.receiptpos = assetOpts.receiptparentnodes.indexOf(assetOpts.receiptvalue)
  if (assetOpts.receiptpos === -1) {
    console.log('Could not find receipt value in receipt parent nodes')
    return
  }
  const dataBuffer = syscoinBufferUtils.serializeMintSyscoin(assetOpts)
  return createAssetTransaction(txVersion, txOpts, utxos, dataBuffer, dataAmount, assetMap, sysChangeAddress, feeRate)
}

function syscoinBurnToAssetAllocation (txOpts, utxos, assetMap, sysChangeAddress, feeRate) {
  const txVersion = utils.SYSCOIN_TX_VERSION_SYSCOIN_BURN_TO_ALLOCATION
  const dataBuffer = null
  let dataAmount = ext.BN_ZERO
  const valueAssetObj = assetMap.values().next().value
  if (valueAssetObj.outputs.length > 0) {
    dataAmount = valueAssetObj.outputs[0].value
  }
  return createAssetTransaction(txVersion, txOpts, utxos, dataBuffer, dataAmount, assetMap, sysChangeAddress, feeRate)
}

module.exports = {
  utils: utils,
  coinSelect: coinSelect,
  bufferUtils: syscoinBufferUtils,
  createTransaction: createTransaction,
  createAssetTransaction: createAssetTransaction,
  assetNew: assetNew,
  assetUpdate: assetUpdate,
  assetSend: assetSend,
  assetAllocationSend: assetAllocationSend,
  assetAllocationBurn: assetAllocationBurn,
  assetAllocationMint: assetAllocationMint,
  syscoinBurnToAssetAllocation: syscoinBurnToAssetAllocation,
  addNotarizationSignatures: addNotarizationSignatures,
  signAndFillNotarizationSigHashesWithWIF: signAndFillNotarizationSigHashesWithWIF,
  fillNotarizationSigHash: fillNotarizationSigHash,
  getAssetsFromTx: getAssetsFromTx,
  getAllocationsFromTx: getAllocationsFromTx,
  getAllocationsFromOutputs: getAllocationsFromOutputs,
  getAssetsFromOutputs: getAssetsFromOutputs,
  createNotarizationOutput: createNotarizationOutput
}
