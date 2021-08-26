const utils = require('./utils')
const ext = require('./bn-extensions')

// break utxos into the maximum number of 'output' possible
module.exports = function broken (utxos, output, feeRate) {
  if (!utils.uintOrNull(feeRate)) return {}
  const changeOutputBytes = utils.outputBytes({})
  let bytesAccum = utils.transactionBytes(utxos, [])
  const value = utils.uintOrNull(output.value)
  const inAccum = utils.sumOrNaN(utxos)

  if (!value || !inAccum) return { fee: ext.mul(feeRate, bytesAccum) }

  const outputBytes = utils.outputBytes(output)
  let outAccum = ext.BN_ZERO
  const outputs = []

  while (true) {
    const fee = ext.mul(feeRate, ext.add(bytesAccum, outputBytes))

    // did we bust?
    if (ext.lt(inAccum, ext.add(outAccum, fee, value))) {
      // premature?
      if (ext.isZero(outAccum)) return { fee: fee }
      break
    }

    bytesAccum = ext.add(bytesAccum, outputBytes)
    outAccum = ext.add(outAccum, value)
    outputs.push(output)
  }

  return utils.finalize(utxos, outputs, feeRate, changeOutputBytes)
}
