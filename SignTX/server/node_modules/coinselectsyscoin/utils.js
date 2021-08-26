const BN = require('bn.js')
const ext = require('./bn-extensions')
const bitcoinops = require('bitcoin-ops')
const bitcoin = require('bitcoinjs-lib')
const SYSCOIN_TX_VERSION_ALLOCATION_BURN_TO_SYSCOIN = 128
const SYSCOIN_TX_VERSION_SYSCOIN_BURN_TO_ALLOCATION = 129
const SYSCOIN_TX_VERSION_ASSET_ACTIVATE = 130
const SYSCOIN_TX_VERSION_ASSET_UPDATE = 131
const SYSCOIN_TX_VERSION_ASSET_SEND = 132
const SYSCOIN_TX_VERSION_ALLOCATION_MINT = 133
const SYSCOIN_TX_VERSION_ALLOCATION_BURN_TO_ETHEREUM = 134
const SYSCOIN_TX_VERSION_ALLOCATION_SEND = 135
function isNonAssetFunded (txVersion) {
  return txVersion === SYSCOIN_TX_VERSION_ASSET_SEND || txVersion === SYSCOIN_TX_VERSION_ASSET_ACTIVATE || txVersion === SYSCOIN_TX_VERSION_SYSCOIN_BURN_TO_ALLOCATION || txVersion === SYSCOIN_TX_VERSION_ALLOCATION_MINT
}
function isAsset (txVersion) {
  return txVersion === SYSCOIN_TX_VERSION_ASSET_ACTIVATE || txVersion === SYSCOIN_TX_VERSION_ASSET_UPDATE || txVersion === SYSCOIN_TX_VERSION_ASSET_SEND
}
function isAllocationBurn (txVersion) {
  return txVersion === SYSCOIN_TX_VERSION_ALLOCATION_BURN_TO_SYSCOIN || txVersion === SYSCOIN_TX_VERSION_ALLOCATION_BURN_TO_ETHEREUM
}
function isAssetAllocationTx (txVersion) {
  return txVersion === SYSCOIN_TX_VERSION_ALLOCATION_BURN_TO_ETHEREUM || txVersion === SYSCOIN_TX_VERSION_ALLOCATION_BURN_TO_SYSCOIN || txVersion === SYSCOIN_TX_VERSION_SYSCOIN_BURN_TO_ALLOCATION || txVersion === SYSCOIN_TX_VERSION_ALLOCATION_SEND
}

// baseline estimates, used to improve performance
const TX_BASE_SIZE = new BN(11)

const TX_INPUT_SIZE = {
  LEGACY: new BN(147),
  P2SH: new BN(91),
  BECH32: new BN(68)
}

const TX_OUTPUT_SIZE = {
  LEGACY: new BN(34),
  P2SH: new BN(32),
  BECH32: new BN(31)
}

function inputBytes (input) {
  return TX_INPUT_SIZE[input.type] || TX_INPUT_SIZE.LEGACY
}

function outputBytes (output) {
  if (output.script) {
    return new BN(output.script.length + 5 + 8) // 5 for OP_PUSHDATA2 max OP_RETURN prefix, 8 for amount
  }
  return TX_OUTPUT_SIZE[output.type] || TX_OUTPUT_SIZE.LEGACY
}

function dustThreshold (output, feeRate) {
  /* ... classify the output for input estimate  */
  return ext.mul(inputBytes(output), feeRate)
}

function transactionBytes (inputs, outputs) {
  return TX_BASE_SIZE
    .add(inputs.reduce(function (a, x) {
      return ext.add(a, inputBytes(x))
    }, ext.BN_ZERO))
    .add(outputs.reduce(function (a, x) {
      return ext.add(a, outputBytes(x))
    }, ext.BN_ZERO))
}

function uintOrNull (v) {
  if (!BN.isBN(v)) return null
  if (v.isNeg()) return null
  return v
}

function sumForgiving (range) {
  return range.reduce(function (a, x) {
    const valueOrZero = BN.isBN(x.value) ? x.value : ext.BN_ZERO
    return ext.add(a, valueOrZero)
  },
  ext.BN_ZERO)
}

function sumOrNaN (range, txVersion) {
  return range.reduce(function (a, x) {
    let value = x.value
    // if SYS to SYSX we don't want to account for the SYS burn amount in outputs (where txVersion is passed in)
    if (txVersion && x.script && txVersion === SYSCOIN_TX_VERSION_SYSCOIN_BURN_TO_ALLOCATION) {
      const chunks = bitcoin.script.decompile(x.script)
      if (chunks[0] === bitcoinops.OP_RETURN) {
        value = ext.BN_ZERO
      }
    }
    return ext.add(a, uintOrNull(value))
  }, ext.BN_ZERO)
}

function hasZeroVal (range) {
  for (let i = 0; i < range.length; i++) {
    if (range[i].value.isZero()) { return true }
  }
  return false
}

function finalize (inputs, outputs, feeRate, feeBytes, txVersion) {
  const bytesAccum = transactionBytes(inputs, outputs)
  const feeAfterExtraOutput = ext.mul(feeRate, ext.add(bytesAccum, feeBytes))
  const remainderAfterExtraOutput = ext.sub(sumOrNaN(inputs), ext.add(sumOrNaN(outputs, txVersion), feeAfterExtraOutput))

  // is it worth a change output?
  if (ext.gt(remainderAfterExtraOutput, dustThreshold({}, feeRate))) {
    outputs = outputs.concat({ changeIndex: outputs.length, value: remainderAfterExtraOutput })
  }

  const fee = ext.sub(sumOrNaN(inputs), sumOrNaN(outputs, txVersion))
  if (!fee) return { fee: ext.mul(feeRate, bytesAccum) }

  return {
    inputs: inputs,
    outputs: outputs,
    fee: fee
  }
}

function finalizeAssets (inputs, outputs, assetAllocations) {
  if (!inputs || !outputs || !assetAllocations) {
    return {
      inputs: null,
      outputs: null,
      assetAllocations: null
    }
  }
  return {
    inputs: inputs,
    outputs: outputs,
    assetAllocations: assetAllocations
  }
}

function getAuxFee (auxfeedetails, nAmount) {
  let nAccumulatedFee = 0
  let nBoundAmount = 0
  let nNextBoundAmount = 0
  let nRate = 0
  for (let i = 0; i < auxfeedetails.auxfees.length; i++) {
    const fee = auxfeedetails.auxfees[i]
    const feeNext = auxfeedetails.auxfees[i < auxfeedetails.auxfees.length - 1 ? i + 1 : i]
    nBoundAmount = fee.bound || 0
    nNextBoundAmount = feeNext.bound

    // max uint16 (65535 = 0.65535 = 65.5535%)
    if (fee.percent) {
      nRate = fee.percent / 100000.0
    } else {
      nRate = 0
    }
    // case where amount is in between the bounds
    if (nAmount >= nBoundAmount && nAmount < nNextBoundAmount) {
      break
    }
    nBoundAmount = nNextBoundAmount - nBoundAmount
    // must be last bound
    if (nBoundAmount <= 0) {
      return new BN((nAmount - nNextBoundAmount) * nRate + nAccumulatedFee)
    }
    nAccumulatedFee += (nBoundAmount * nRate)
  }
  return new BN((nAmount - nBoundAmount) * nRate + nAccumulatedFee)
}

function createAssetID (NFTID, assetGuid) {
  const BN_ASSET = new BN(NFTID || 0).shln(32).or(new BN(assetGuid))
  return BN_ASSET.toString(10)
}

function getBaseAssetID (assetGuid) {
  return new BN(assetGuid).and(new BN(0xFFFFFFFF)).toString(10)
}

module.exports = {
  dustThreshold: dustThreshold,
  finalize: finalize,
  finalizeAssets: finalizeAssets,
  inputBytes: inputBytes,
  outputBytes: outputBytes,
  sumOrNaN: sumOrNaN,
  sumForgiving: sumForgiving,
  transactionBytes: transactionBytes,
  uintOrNull: uintOrNull,
  getAuxFee: getAuxFee,
  SYSCOIN_TX_VERSION_ALLOCATION_BURN_TO_SYSCOIN: SYSCOIN_TX_VERSION_ALLOCATION_BURN_TO_SYSCOIN,
  SYSCOIN_TX_VERSION_SYSCOIN_BURN_TO_ALLOCATION: SYSCOIN_TX_VERSION_SYSCOIN_BURN_TO_ALLOCATION,
  SYSCOIN_TX_VERSION_ASSET_ACTIVATE: SYSCOIN_TX_VERSION_ASSET_ACTIVATE,
  SYSCOIN_TX_VERSION_ASSET_UPDATE: SYSCOIN_TX_VERSION_ASSET_UPDATE,
  SYSCOIN_TX_VERSION_ASSET_SEND: SYSCOIN_TX_VERSION_ASSET_SEND,
  SYSCOIN_TX_VERSION_ALLOCATION_MINT: SYSCOIN_TX_VERSION_ALLOCATION_MINT,
  SYSCOIN_TX_VERSION_ALLOCATION_BURN_TO_ETHEREUM: SYSCOIN_TX_VERSION_ALLOCATION_BURN_TO_ETHEREUM,
  SYSCOIN_TX_VERSION_ALLOCATION_SEND: SYSCOIN_TX_VERSION_ALLOCATION_SEND,
  isNonAssetFunded: isNonAssetFunded,
  isAsset: isAsset,
  isAllocationBurn: isAllocationBurn,
  hasZeroVal: hasZeroVal,
  isAssetAllocationTx: isAssetAllocationTx,
  createAssetID: createAssetID,
  getBaseAssetID: getBaseAssetID

}
