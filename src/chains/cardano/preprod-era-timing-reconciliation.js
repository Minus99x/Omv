// Read-only reconciliation of hash-pinned public Preprod genesis against
// authenticated Ogmios era summaries and the stable-tip epoch observed by two
// providers. This is NOT independent full Conway phase-one validation.
import { hashCardanoEvidence } from './evidence-binding.js';
import {
  PREPROD_SHELLEY_GENESIS_HASH,
  PREPROD_CONWAY_GENESIS_HASH
} from './preprod-genesis-timing.js';

function nonNegative(value,label,positive=false) {
  if (!Number.isSafeInteger(value)||value<0||(positive&&value===0))
    throw new TypeError(label+' must be a '+(positive?'positive':'non-negative')+' safe integer.');
  return value;
}
function bound(value,label) {
  if (!value||typeof value!=='object'||Array.isArray(value)) throw new TypeError(label+' must be an era bound.');
  return Object.freeze({
    slot:nonNegative(value.slot,label+'.slot'),
    epoch:nonNegative(value.epoch,label+'.epoch'),
    seconds:nonNegative(value.time?.seconds,label+'.time.seconds')
  });
}
function checkedEra(value,index) {
  const label='Ogmios eraSummaries['+index+']';
  const start=bound(value?.start,label+'.start');
  const end=value?.end==null?null:bound(value.end,label+'.end');
  const epochLength=nonNegative(value?.parameters?.epochLength,label+'.parameters.epochLength',true);
  const slotLengthMs=nonNegative(value?.parameters?.slotLength?.milliseconds,label+'.parameters.slotLength.milliseconds',true);
  if (end && (end.slot<=start.slot || end.epoch<start.epoch || end.seconds<=start.seconds))
    throw new Error(label+' has non-increasing era bounds.');
  return Object.freeze({start,end,epochLength,slotLengthMs});
}
function checkedGenesis(report) {
  if (!report || report.schema!=='omegavault.cardano.preprod-public-genesis-timing.v1' ||
      report.network!=='preprod' ||
      report.genesis?.shelleyBlake2b256!==PREPROD_SHELLEY_GENESIS_HASH ||
      report.genesis?.conwayBlake2b256!==PREPROD_CONWAY_GENESIS_HASH ||
      report.genesis?.rawGenesisBytesVerified!==true ||
      report.authenticPublishedGenesisProvenanceChecked!==true ||
      report.timing?.systemStart!=='2022-06-01T00:00:00Z' ||
      report.timing?.epochLength!==432000 || report.timing?.slotLength!==1 ||
      report.completePhaseOneValidated!==false ||
      report.transactionSubmissionAuthorized!==false) {
    throw new Error('Authentic pinned Preprod public genesis evidence is required.');
  }
  const {reportSha256,...core}=report;
  if (reportSha256!==hashCardanoEvidence(core))
    throw new Error('Public genesis timing report digest no longer reproduces.');
}

export function reconcileCardanoPreprodEraTiming({
  genesisReport,networkStartTime,eraSummaries,stableTip,observedEpoch
}) {
  checkedGenesis(genesisReport);
  if (typeof networkStartTime!=='string' ||
      !Number.isFinite(Date.parse(networkStartTime)) ||
      Date.parse(networkStartTime)!==Date.parse(genesisReport.timing.systemStart)) {
    throw new Error('Authenticated Ogmios network start time disagrees with pinned public Preprod genesis.');
  }
  if (!Array.isArray(eraSummaries)||eraSummaries.length<1||eraSummaries.length>32)
    throw new TypeError('Ogmios must return a bounded sequence of era summaries.');
  const eras=eraSummaries.map(checkedEra);
  if (eras[0].start.slot!==0 || eras[0].start.seconds!==0 ||
      eras[0].start.epoch!==0) throw new Error('Ogmios era summaries do not start at network origin.');
  for (let i=1;i<eras.length;i++) {
    const previous=eras[i-1],next=eras[i];
    if (!previous.end || previous.end.slot!==next.start.slot ||
        previous.end.seconds!==next.start.seconds ||
        previous.end.epoch!==next.start.epoch)
      throw new Error('Ogmios era summaries have a gap, overlap, or broken boundary.');
  }
  if (!stableTip || typeof stableTip.hash!=='string' ||
      !/^[0-9a-f]{64}$/.test(stableTip.hash) ||
      !Number.isSafeInteger(stableTip.slot) || stableTip.slot<0)
    throw new TypeError('An unchanged authenticated ledger tip is required.');
  const epoch=nonNegative(observedEpoch,'Ogmios/Blockfrost agreed current epoch');
  const active=eras.filter(e=>stableTip.slot>=e.start.slot && (!e.end || stableTip.slot<e.end.slot));
  if (active.length!==1) throw new Error('Stable tip is not in exactly one current Ogmios era interval.');
  const era=active[0];
  const predictedEpoch=era.start.epoch+Math.floor((stableTip.slot-era.start.slot)/era.epochLength);
  if (!Number.isSafeInteger(predictedEpoch)||predictedEpoch!==epoch)
    throw new Error('Two-provider observed epoch disagrees with Ogmios era slotting.');
  const slotTime=Date.parse(genesisReport.timing.systemStart)+
    era.start.seconds*1000+(stableTip.slot-era.start.slot)*era.slotLengthMs;
  if (!Number.isSafeInteger(slotTime)||!Number.isFinite(new Date(slotTime).getTime()))
    throw new Error('Stable-tip slot time cannot be safely derived from Ogmios era summaries.');
  const core=Object.freeze({
    schema:'omegavault.cardano.preprod-era-timing-reconciliation.v1',
    network:'preprod',
    stableTip:Object.freeze({hash:stableTip.hash,slot:stableTip.slot}),
    publicGenesisReportSha256:genesisReport.reportSha256,
    genesisHashes:Object.freeze({
      shelley:PREPROD_SHELLEY_GENESIS_HASH,
      conway:PREPROD_CONWAY_GENESIS_HASH
    }),
    networkStartTime:genesisReport.timing.systemStart,
    activeEraStart:Object.freeze({slot:era.start.slot,epoch:era.start.epoch,offsetSeconds:era.start.seconds}),
    currentEraEpochLength:era.epochLength,
    currentEraSlotLengthMilliseconds:era.slotLengthMs,
    currentEpoch:epoch,
    derivedCurrentSlotStartUtc:new Date(slotTime).toISOString(),
    observedNodeGenesisStartAgreesWithPublicGenesis:true,
    observedEpochAgreesWithEraSummaries:true,
    originalShelleyEraTimingPresent:eras.some(e=>
      e.epochLength===genesisReport.timing.epochLength &&
      e.slotLengthMs===genesisReport.timing.slotLength*1000),
    authenticatedOgmiosEraSummariesRead:true,
    independentlyVerifiedCurrentEraTiming:false,
    completeConwayParametersEstablished:false,
    completePhaseOneValidated:false,
    walletSigningAuthorized:false,
    transactionSubmissionAuthorized:false,
    transactionSubmissionPerformed:false,
    authorityBoundary:'Node-reported era-slot arithmetic reconciled to pinned public genesis and agreed current epoch at one stable tip. No independent confirmation of every current era setting, no ledger phase-one verdict or signing/submission.'
  });
  return Object.freeze({...core,reportSha256:hashCardanoEvidence(core)});
}
