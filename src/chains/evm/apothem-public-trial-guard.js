/**
 * Pure public-Apothem disposable proof safety gate.
 * No keys, signers, network calls, transaction creation, or broad connector promotion.
 */
export const XDC_PUBLIC_TRIAL_NETWORK = Object.freeze({
  name:'xdc-apothem',chainId:51,hex:'0x33',
  endpoints:Object.freeze(['https://rpc.apothem.network','https://erpc.apothem.network'])
});
export const XDC_PUBLIC_TRIAL_FEE_LIMIT_WEI=5n*10n**18n;
export const XDC_PUBLIC_TRIAL_DEPOSIT_WEI=10n**17n; // only 0.1 disposable TXDC
const ADDRESS=/^0x[0-9a-fA-F]{40}$/;
const HEX=/^0x[a-fA-F0-9]*$/;
const TX=/^0x[a-fA-F0-9]{64}$/;
const ROLES=Object.freeze(['owner','guardianA','guardianB','rescue']);

export function validateApothemTrialRoles(roles){
 if(!roles||typeof roles!=='object')throw new TypeError('Disposable wallet roles required.');
 const a=ROLES.map(x=>{
  const address=roles[x];
  if(typeof address!=='string'||!ADDRESS.test(address)||/^0x0{40}$/i.test(address))
   throw new TypeError('Invalid nonzero EVM account for '+x);
  return address.toLowerCase();
 });
 if(new Set(a).size!==4)throw new Error('Owner, guardians and rescue must be distinct accounts.');
 return Object.freeze(Object.fromEntries(ROLES.map((r,i)=>[r,a[i]])));
}
export function requirePublicApothemChainId(value){
 // EIP-1474 Quantity: primitive 0x-prefixed hexadecimal with no leading zeroes.
 if(typeof value!=='string'||!/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value))
  throw new TypeError('RPC chain ID invalid; canonical 0x quantity required.');
 if(BigInt(value)!==51n)throw new Error('Live proof limited to XDC Apothem chain ID 51; mismatched/mainnet network refused.');
 return 51;
}
function unsignedExact(value,label){
 if(typeof value==='bigint'&&value>=0n)return value;
 if(typeof value==='number'&&Number.isSafeInteger(value)&&value>=0)return BigInt(value);
 if(typeof value==='string'&&(/^(?:0|[1-9][0-9]*)$/.test(value)||/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value)))
  return BigInt(value);
 throw new TypeError(label+' must be an exact non-negative primitive integer.');
}
export function boundedApothemFee({estimatedGas,gasPriceWei,spentFeeWei=0n,capWei=XDC_PUBLIC_TRIAL_FEE_LIMIT_WEI}){
 const gas=unsignedExact(estimatedGas,'estimatedGas'),price=unsignedExact(gasPriceWei,'gasPriceWei');
 const spent=unsignedExact(spentFeeWei,'spentFeeWei'),cap=unsignedExact(capWei,'capWei');
 if(gas<21000n||gas>3000000n||price<1n||price>1000000000000n)
  throw new Error('Public Apothem gas or gas-price bounds failed.');
 if(spent<0n||cap<=0n||cap>XDC_PUBLIC_TRIAL_FEE_LIMIT_WEI||spent>cap)
  throw new Error('Public Apothem cumulative budget cannot exceed five fake TXDC.');
 const gasLimit=(gas*125n+99n)/100n;
 const maxFee=gasLimit*price;
 if(maxFee>cap-spent)throw new Error('Public Apothem cumulative fee ceiling exceeded; transaction blocked.');
 return Object.freeze({gasLimit,gasPriceWei:price,maxFee,remainingAfterReservation:cap-spent-maxFee});
}
export function verifyApothemReceipt({receipt,transactionHash,expectedContract=null}){
 if(!receipt||!([1,1n,'0x1'].includes(receipt.status)))throw new Error('Receipt did not prove an included successful transaction.');
 const receiptHash=receipt.hash??receipt.transactionHash;
 if(typeof transactionHash!=='string'||!TX.test(transactionHash)||typeof receiptHash!=='string'||
    !TX.test(receiptHash)||receiptHash.toLowerCase()!==transactionHash.toLowerCase())
  throw new Error('Receipt transaction hash mismatch.');
 let blockNumber;
 try{blockNumber=unsignedExact(receipt.blockNumber,'receipt.blockNumber');}catch{throw new Error('Receipt does not contain canonical block identity.');}
 if(blockNumber===0n||typeof receipt.blockHash!=='string'||!TX.test(receipt.blockHash))
  throw new Error('Receipt does not contain canonical block identity.');
 if(expectedContract!=null&&(typeof expectedContract!=='string'||!ADDRESS.test(expectedContract)||
   typeof receipt.contractAddress!=='string'||!ADDRESS.test(receipt.contractAddress)||
   receipt.contractAddress.toLowerCase()!==expectedContract.toLowerCase()))
  throw new Error('Deployment contract address mismatches receipt.');
 let gasUsed,gasPrice;
 try{
  gasUsed=unsignedExact(receipt.gasUsed,'receipt.gasUsed');
  gasPrice=unsignedExact(receipt.gasPrice,'receipt.gasPrice');
 }catch{throw new Error('Receipt has invalid fee observations.');}
 if(gasUsed<21000n||gasPrice<1n)throw new Error('Receipt has invalid fee observations.');
 return Object.freeze({
  txHash:transactionHash.toLowerCase(),
  blockNumber:blockNumber.toString(),
  blockHash:receipt.blockHash.toLowerCase(),
  contractAddress:receipt.contractAddress??null,
  gasUsed:gasUsed.toString(),
  gasPriceWei:gasPrice.toString(),
  actualFeeWei:(gasUsed*gasPrice).toString()
 });
}
export function verifyApothemRuntimeBytecode({compiledRuntime,immutableReferences={},actualRuntime}){
 if(typeof compiledRuntime!=='string'||!HEX.test(compiledRuntime)||compiledRuntime.length<4||
    typeof actualRuntime!=='string'||!HEX.test(actualRuntime))
  throw new Error('Deployment runtime must be canonical 0x-bytecode.');
 const expected=compiledRuntime.slice(2).toLowerCase();
 const actual=actualRuntime.slice(2).toLowerCase();
 if(expected.length!==actual.length||expected.length%2!==0)throw new Error('Runtime bytecode size mismatch.');
 const ignored=new Set();
 for(const slots of Object.values(immutableReferences)){
  if(!Array.isArray(slots))throw new Error('Malformed immutable reference offsets.');
  for(const slot of slots){
   const start=Number(slot?.start),length=Number(slot?.length);
   if(!Number.isSafeInteger(start)||!Number.isSafeInteger(length)||start<0||length<=0||start+length>actual.length/2)
     throw new Error('Immutable reference extends outside compiled runtime.');
   for(let i=start;i<start+length;i++)ignored.add(i);
  }
 }
 for(let i=0;i<expected.length/2;i++){
  if(!ignored.has(i)&&expected.slice(i*2,i*2+2)!==actual.slice(i*2,i*2+2))
   throw new Error('Deployed runtime differs from pinned compiled V0.5.1 beyond immutable slots.');
 }
 return Object.freeze({runtimeBytes:actual.length/2,immutableBytes:ignored.size,matched:true});
}
