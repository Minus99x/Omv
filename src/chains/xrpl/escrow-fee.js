import { normalizeXrplFeeDrops } from './signer-list.js';

// Matches the documented XRPL EscrowFinish structural cost calculation.
// This is an offline floor only; live network queue/load fees require an
// independently observed server fee and are not claimed here.
export function calculateXrplEscrowFinishFeeDrops({
  baseFeeDrops, fulfillmentHex=null, signerCount=0
}={}) {
  const base=BigInt(normalizeXrplFeeDrops(baseFeeDrops,'baseFeeDrops'));
  if(base===0n) throw new TypeError('XRPL EscrowFinish requires a positive reference base fee.');
  if (!Number.isInteger(signerCount) || signerCount<0 || signerCount>32) {
    throw new TypeError('XRPL signerCount must be a non-negative integer at most 32.');
  }
  let fulfillmentBytes=0;
  if (fulfillmentHex!=null) {
    if(typeof fulfillmentHex!=='string' || !/^(?:[a-fA-F0-9]{2})+$/.test(fulfillmentHex)) {
      throw new TypeError('XRPL escrow fulfillment must be nonempty even-length hexadecimal bytes.');
    }
    fulfillmentBytes=fulfillmentHex.length/2;
  }
  const multiplier=BigInt(signerCount+(fulfillmentHex==null ? 1 : 33+Math.floor(fulfillmentBytes/16)));
  const floor=base*multiplier;
  if(floor>100000000000000000n) throw new RangeError('XRPL escrow fee floor exceeds XRP supply.');
  return Object.freeze({
    minimumFeeDrops:floor.toString(),
    baseFeeDrops:base.toString(),
    signerCount,
    fulfillmentBytes,
    formula:'xrpl-escrowfinish-offline-structural-base-fee',
    loadScaledFeeEstablished:false
  });
}
