import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { verifyDetachedPublicationHeadReceiptSignature, verifyPublicationHeadReceipt } from '../src/core/publication-head-receipt.js';
import { verifyCurrentPublicationHeadReceipt } from '../src/core/publication-head-history.js';

function arg(name) { const index=process.argv.indexOf(`--${name}`); return index >= 0 ? process.argv[index+1] : null; }

const receiptPath=arg('receipt');
const historyPath=arg('anchor-history');
const snapshotPath=arg('anchor-history-snapshot');
const signaturePath=arg('signature');
const publicKeyPath=arg('public-key');
const publicationHistoryPath=arg('publication-history');
const publicationHistorySnapshotPath=arg('publication-history-snapshot');
const requireAuthenticated=process.argv.includes('--require-authenticated-publisher');

if (!receiptPath
  || !historyPath
  || !snapshotPath
  || Boolean(signaturePath)!==Boolean(publicKeyPath)
  || Boolean(publicationHistoryPath)!==Boolean(publicationHistorySnapshotPath)
  || (requireAuthenticated && !signaturePath)) {
  process.stderr.write('Usage: node scripts/verify-publication-head-receipt.js --receipt <receipt.json> --anchor-history <history.json> --anchor-history-snapshot <snapshot.json> [--signature <signature.json> --public-key <publisher-public.pem> --require-authenticated-publisher] [--publication-history <publication-history.json> --publication-history-snapshot <publication-history-snapshot.json>]\n');
  process.exit(2);
}

try {
  const receipt=JSON.parse(readFileSync(resolve(receiptPath),'utf8'));
  const current=verifyPublicationHeadReceipt(receipt,{
    history:JSON.parse(readFileSync(resolve(historyPath),'utf8')),
    historySnapshot:JSON.parse(readFileSync(resolve(snapshotPath),'utf8'))
  });
  const authentication=signaturePath
    ? verifyDetachedPublicationHeadReceiptSignature(
        JSON.parse(readFileSync(resolve(signaturePath),'utf8')),
        receipt,
        readFileSync(resolve(publicKeyPath))
      )
    : null;

  const publicationCurrent=publicationHistoryPath
    ? verifyCurrentPublicationHeadReceipt({
        receipt,
        history:JSON.parse(readFileSync(resolve(publicationHistoryPath),'utf8')),
        historySnapshot:JSON.parse(readFileSync(resolve(publicationHistorySnapshotPath),'utf8'))
      })
    : null;

  const ok=current.ok
    && (!authentication || authentication.ok)
    && (!requireAuthenticated || authentication?.authenticated===true)
    && (!publicationCurrent || publicationCurrent.ok);

  const errors=[
    ...current.errors,
    ...(authentication?.errors.map(error=>`Publisher authentication: ${error}`) ?? []),
    ...(publicationCurrent?.errors.map(error=>`Publication history: ${error}`) ?? [])
  ];

  process.stdout.write(`${JSON.stringify({
    ok,
    current:current.current,
    publisherAuthenticated:authentication?.authenticated ?? false,
    publisherAuthenticationConfigured:Boolean(authentication),
    publicationHistoryConfigured:Boolean(publicationCurrent),
    publicationReceiptCurrent:publicationCurrent?.current ?? false,
    publisher:receipt?.publisher ?? null,
    publicationReceiptSha256:receipt?.sha256 ?? null,
    headAnchorSha256:receipt?.anchorHistory?.headAnchorSha256 ?? null,
    promotionAuthority:false,
    reviewerTrustAuthority:false,
    anchoringAuthorityTrust:false,
    deploymentAuthority:false,
    walletAuthority:false,
    errors
  },null,2)}\n`);
  if (!ok) process.exitCode=1;
} catch(error) {
  process.stderr.write(`Publication-head receipt verification failed: ${error.message}\n`);
  process.exitCode=1;
}
