import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { verifyDetachedPublicationHeadReceiptSignature, verifyPublicationHeadReceipt } from '../src/core/publication-head-receipt.js';

function arg(name) { const index=process.argv.indexOf(`--${name}`); return index >= 0 ? process.argv[index+1] : null; }
const receiptPath=arg('receipt'); const historyPath=arg('anchor-history'); const snapshotPath=arg('anchor-history-snapshot'); const signaturePath=arg('signature'); const publicKeyPath=arg('public-key'); const requireAuthenticated=process.argv.includes('--require-authenticated-publisher');
if (!receiptPath || !historyPath || !snapshotPath || Boolean(signaturePath)!==Boolean(publicKeyPath) || (requireAuthenticated && !signaturePath)) {
  process.stderr.write('Usage: node scripts/verify-publication-head-receipt.js --receipt <receipt.json> --anchor-history <history.json> --anchor-history-snapshot <snapshot.json> [--signature <signature.json> --public-key <publisher-public.pem> --require-authenticated-publisher]\n');
  process.exit(2);
}
try {
  const receipt=JSON.parse(readFileSync(resolve(receiptPath),'utf8'));
  const current=verifyPublicationHeadReceipt(receipt,{history:JSON.parse(readFileSync(resolve(historyPath),'utf8')),historySnapshot:JSON.parse(readFileSync(resolve(snapshotPath),'utf8'))});
  const authentication=signaturePath ? verifyDetachedPublicationHeadReceiptSignature(JSON.parse(readFileSync(resolve(signaturePath),'utf8')),receipt,readFileSync(resolve(publicKeyPath))) : null;
  const ok=current.ok && (!authentication || authentication.ok) && (!requireAuthenticated || authentication?.authenticated===true);
  const errors=[...current.errors,...(authentication?.errors.map(error=>`Publisher authentication: ${error}`) ?? [])];
  process.stdout.write(`${JSON.stringify({ok,current:current.current,publisherAuthenticated:authentication?.authenticated ?? false,publisherAuthenticationConfigured:Boolean(authentication),publisher:receipt?.publisher ?? null,publicationReceiptSha256:receipt?.sha256 ?? null,headAnchorSha256:receipt?.anchorHistory?.headAnchorSha256 ?? null,promotionAuthority:false,reviewerTrustAuthority:false,anchoringAuthorityTrust:false,deploymentAuthority:false,walletAuthority:false,errors},null,2)}\n`);
  if (!ok) process.exitCode=1;
} catch(error) { process.stderr.write(`Publication-head receipt verification failed: ${error.message}\n`); process.exitCode=1; }
