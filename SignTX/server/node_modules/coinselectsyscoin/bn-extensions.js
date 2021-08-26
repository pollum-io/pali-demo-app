const BN = require('bn.js')
const slice = Array.prototype.slice

const BN_ZERO = new BN(0)
const BN_ONE = new BN(1)

function add () {
  const args = slice.call(arguments)
  return args.reduce(_add)
}

function _add (a, b) {
  if (!BN.isBN(a) || !BN.isBN(b)) return null
  return a.add(b)
}

function sub () {
  const args = slice.call(arguments)
  return args.reduce(_sub)
}

function _sub (a, b) {
  if (!BN.isBN(a) || !BN.isBN(b)) return null
  return a.sub(b)
}

function mul () {
  const args = slice.call(arguments)
  return args.reduce(_mul)
}

function _mul (a, b) {
  if (!BN.isBN(a) || !BN.isBN(b)) return null
  return a.mul(b)
}

function div () {
  const args = slice.call(arguments)
  return args.reduce(_div)
}

function _div (a, b) {
  if (!BN.isBN(a) || !BN.isBN(b)) return null
  if (b.isZero()) return null
  return a.div(b)
}

function isZero (v) {
  if (!BN.isBN(v)) return false
  return v.isZero()
}

function eq (a, b) {
  if (!BN.isBN(a) || !BN.isBN(b)) return false
  return a.eq(b)
}

function lt (a, b) {
  if (!BN.isBN(a) || !BN.isBN(b)) return false
  return a.lt(b)
}

function lte (a, b) {
  if (!BN.isBN(a) || !BN.isBN(b)) return false
  return a.lte(b)
}

function gt (a, b) {
  if (!BN.isBN(a) || !BN.isBN(b)) return false
  return a.gt(b)
}

function gte (a, b) {
  if (!BN.isBN(a) || !BN.isBN(b)) return false
  return a.gte(b)
}

function mod (a, b) {
  if (!BN.isBN(a) || !BN.isBN(b)) return null
  return a.mod(b)
}

function or (a, b) {
  if (!BN.isBN(a) || !BN.isBN(b)) return false
  return a.or(b)
}

function and (a, b) {
  if (!BN.isBN(a) || !BN.isBN(b)) return false
  return a.and(b)
}

function shln (a, b) {
  if (!BN.isBN(a) || !BN.isBN(b)) return false
  return a.shln(b)
}

function shrn (a, b) {
  if (!BN.isBN(a) || !BN.isBN(b)) return false
  return a.shrn(b)
}

function neg (a) {
  if (!BN.isBN(a)) return false
  return a.neg()
}

module.exports = {
  mul: mul,
  div: div,
  mod: mod,
  add: add,
  sub: sub,
  isZero: isZero,
  eq: eq,
  lt: lt,
  lte: lte,
  gt: gt,
  gte: gte,
  or: or,
  and: and,
  shln: shln,
  shrn: shrn,
  neg: neg,
  BN_ZERO: BN_ZERO,
  BN_ONE: BN_ONE
}
