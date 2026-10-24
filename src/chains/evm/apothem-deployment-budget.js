/**
 * XDC Apothem-only offline gas-budget arithmetic and ABI encoder.
 * Never signs, transmits, deploys, or implies production readiness.
 */
const ADDR=/^0x[0-9a-fA-F]{40}$/;
const BYTECODE=/^(?:[a-fA-F0-9]{2})+$/;
const MAX_BUDGET_WEI=5n*10n**18n; // 5 disposable TXDC
function quantity(value,label){
  if(typeof value!=='string'|| !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]{0,63})$/.test(value))throw new TypeError(label+' must be canonical uint256 hex quantity');
  return BigInt(value);
}
function address(addr,label){
  if(typeof addr!=='string'||!ADDR.test(addr)||/^0x0{40}$/i.test(addr))throw new TypeError(label+' must be a nonzero 20-byte 0x EVM address');
  return addr.slice(2).toLowerCase().padStart(64,'0');
}
function word(value,label){
  const v=BigInt(value);
  if(v<0n||v>=2n**256n)throw new RangeError(label+' exceeds uint256 range');
  return v.toString(16).padStart(64,'0');
}
export function encodeRecoveryVaultConstructor({owner,contacts,rescue,threshold,inactivitySeconds}){
  address(owner,'owner');
  if(!Array.isArray(contacts)||contacts.length<1||contacts.length>32)throw new TypeError('One to 32 contacts are required');
  if(!Number.isInteger(threshold)||threshold<1||threshold>contacts.length)throw new TypeError('Threshold exceeds available guardians');
  if(!Number.isInteger(inactivitySeconds)||inactivitySeconds<1||!Number.isSafeInteger(inactivitySeconds))throw new TypeError('Invalid inactivity seconds');
  const destination=address(rescue,'rescue');
  if(owner.toLowerCase()===rescue.toLowerCase())throw new Error('Owner and rescue must be distinct accounts');
  const unique=new Set([owner.toLowerCase(),rescue.toLowerCase()]);
  const encodedContacts=contacts.map(x=>{
    const normalized='0x'+address(x,'contact').slice(-40);
    if(unique.has(normalized))throw new Error('Owner, rescue and guardians must all be different');
    unique.add(normalized);
    return address(x,'contact');
  });
  return '0x'+[
    word(128,'constructor head offset'),
    word(threshold,'threshold'),
    word(inactivitySeconds,'inactivitySeconds'),
    destination,
    word(encodedContacts.length,'number of contacts'),
    ...encodedContacts
  ].join('');
}
export function createApothemReadOnlyDeploymentBudget({
  compiledCreationBytecode,estimatedGasHex=null,providerGasPriceHex,baseFeePerGasHex=null,
  compilerVersion,codeSizeBytes,maxBudgetWei=MAX_BUDGET_WEI
}){
  if(typeof compilerVersion!=='string'||!/^0\.8\.24(?:\+|$)/.test(compilerVersion))throw new Error('Deployment bytecode must be compiled with pinned solc 0.8.24');
  if(typeof compiledCreationBytecode!=='string'||!BYTECODE.test(compiledCreationBytecode))throw new TypeError('Missing canonical compiled deployment bytecode');
  if(!Number.isInteger(codeSizeBytes)||codeSizeBytes<1||codeSizeBytes>24576)throw new Error('Runtime bytecode exceeds size policy');
  if(!Array.isArray(providerGasPriceHex)||providerGasPriceHex.length!==2)throw new TypeError('Two gas-price observations required');
  const quotes=providerGasPriceHex.map((v,i)=>quantity(v,'provider '+i+' gas price'));
  if(quotes.some(v=>v<=0n))throw new Error('Non-positive RPC gas quote');
  const price=quotes[0]>quotes[1]?quotes[0]:quotes[1];
  if(typeof maxBudgetWei!=='bigint' &&
    !(typeof maxBudgetWei==='number'&&Number.isSafeInteger(maxBudgetWei)) &&
    !(typeof maxBudgetWei==='string'&&/^(0|[1-9][0-9]*)$/.test(maxBudgetWei)))
    throw new TypeError('Testnet budget cap must be an exact primitive integer');
  const budgetMax=BigInt(maxBudgetWei);
  if(budgetMax<=0n||budgetMax>MAX_BUDGET_WEI)throw new Error('Testnet budget cap cannot exceed 5 fake TXDC');
  const baseFee=baseFeePerGasHex==null?null:quantity(baseFeePerGasHex,'block base fee');
  const gas=estimatedGasHex==null?null:quantity(estimatedGasHex,'gas estimate');
  if(gas!=null && gas<21000n)throw new Error('Impossible contract deployment gas estimate');
  const gasWithBuffer=gas==null?null:(gas*125n+99n)/100n;
  const budgetWei=gasWithBuffer==null?null:gasWithBuffer*price;
  return Object.freeze({
    schema:'omegavault.xdc.apothem-deployment-budget.v1',networkRef:'xdc:apothem',
    compileVerified:true,compilerVersion,creationBytecodeBytes:compiledCreationBytecode.length/2,
    runtimeBytecodeBytes:codeSizeBytes,
    providerGasPriceWei:Object.freeze(quotes.map(String)),
    maxObservedGasPriceWei:String(price),
    observedBaseFeeWei:baseFee?.toString()??null,
    gasEstimate:gas?.toString()??null,
    bufferedGasLimit:gasWithBuffer?.toString()??null,
    conservativeTxFeeBudgetWei:budgetWei?.toString()??null,
    maxAllowedFakeTxdcWei:budgetMax.toString(),
    withinFeeCap:budgetWei!=null&&budgetWei<=budgetMax&&(baseFee==null||price>=baseFee),
    deploymentEligible: false, // Funding, chain deployment and security checks remain separate
    transactionSigned:false,transactionBroadcast:false,realMoneyUsed:false
  });
}
export const XDC_APOTHEM_DISPOSABLE_MAX_FEE_WEI=MAX_BUDGET_WEI;
