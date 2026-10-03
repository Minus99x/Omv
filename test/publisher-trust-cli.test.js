import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import {
  createPublisherTrustEvent,
  createPublisherTrustHistorySnapshot
} from '../src/core/publisher-trust-history.js';

function run(script,args){return spawnSync(process.execPath,[script,...args],{cwd:process.cwd(),encoding:'utf8'});}
function pem(key){return key.publicKey.export({type:'spki',format:'pem'});}

test('publisher trust append and verify CLIs support enroll and rotation with overwrite protection',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'omegavault-publisher-trust-cli-'));
  const first=generateKeyPairSync('ed25519');
  const second=generateKeyPairSync('ed25519');
  const firstKey=path.join(dir,'first.pem');
  const secondKey=path.join(dir,'second.pem');
  const history1=path.join(dir,'history-1.json');
  const snapshot1=path.join(dir,'snapshot-1.json');
  const history2=path.join(dir,'history-2.json');
  const snapshot2=path.join(dir,'snapshot-2.json');
  fs.writeFileSync(firstKey,pem(first));
  fs.writeFileSync(secondKey,pem(second));

  const enroll=run('scripts/append-publisher-trust-event.js',[
    '--publisher','release-registry','--public-key',firstKey,'--action','enroll',
    '--configured-by','release-policy','--configured-at','2026-10-03T21:10:00.000Z',
    '--output',history1,'--snapshot-output',snapshot1
  ]);
  assert.equal(enroll.status,0,enroll.stderr);
  assert.equal(JSON.parse(enroll.stdout).status,'trusted');

  const rotate=run('scripts/append-publisher-trust-event.js',[
    '--publisher','release-registry','--public-key',secondKey,'--action','rotate',
    '--configured-by','release-policy','--configured-at','2026-10-03T21:11:00.000Z',
    '--history',history1,'--output',history2,'--snapshot-output',snapshot2
  ]);
  assert.equal(rotate.status,0,rotate.stderr);
  assert.equal(JSON.parse(rotate.stdout).eventCount,2);

  const verify=run('scripts/verify-publisher-trust-history.js',['--history',history2,'--snapshot',snapshot2]);
  assert.equal(verify.status,0,verify.stderr);
  const verified=JSON.parse(verify.stdout);
  assert.equal(verified.ok,true);
  assert.equal(verified.status,'trusted');

  const overwrite=run('scripts/append-publisher-trust-event.js',[
    '--publisher','release-registry','--public-key',secondKey,'--action','rotate',
    '--configured-by','release-policy','--configured-at','2026-10-03T21:12:00.000Z',
    '--history',history1,'--output',history2
  ]);
  assert.equal(overwrite.status,1);
});

test('publisher trust CLIs reject rollback snapshots and all secret-bearing arguments',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'omegavault-publisher-trust-rollback-'));
  const first=generateKeyPairSync('ed25519');
  const second=generateKeyPairSync('ed25519');
  const firstKey=path.join(dir,'first.pem');
  const secondKey=path.join(dir,'second.pem');
  fs.writeFileSync(firstKey,pem(first));
  fs.writeFileSync(secondKey,pem(second));

  const enroll=createPublisherTrustEvent({
    publisher:'release-registry',publicKey:first.publicKey,action:'enroll',
    configuredBy:'release-policy',configuredAt:'2026-10-03T21:20:00.000Z'
  });
  const rotate=createPublisherTrustEvent({
    publisher:'release-registry',publicKey:second.publicKey,action:'rotate',
    configuredBy:'release-policy',configuredAt:'2026-10-03T21:21:00.000Z',previousEvent:enroll
  });
  const full=[enroll,rotate];
  const history=path.join(dir,'history.json');
  const staleSnapshot=path.join(dir,'stale-snapshot.json');
  fs.writeFileSync(history,JSON.stringify(full));
  fs.writeFileSync(staleSnapshot,JSON.stringify(createPublisherTrustHistorySnapshot([enroll])));

  const rollback=run('scripts/verify-publisher-trust-history.js',['--history',history,'--snapshot',staleSnapshot]);
  assert.equal(rollback.status,1);
  assert.equal(JSON.parse(rollback.stdout).ok,false);

  for (const forbidden of ['private-key','secret-key','seed','key-output']) {
    const append=run('scripts/append-publisher-trust-event.js',[
      '--publisher','release-registry','--public-key',firstKey,'--action','enroll',
      '--configured-by','release-policy','--configured-at','2026-10-03T21:22:00.000Z',
      '--output',path.join(dir,`forbidden-${forbidden}.json`),`--${forbidden}`,'secret'
    ]);
    assert.equal(append.status,1);
    assert.match(append.stderr,/secret input .* forbidden/i);

    const verify=run('scripts/verify-publisher-trust-history.js',[
      '--history',history,'--snapshot',staleSnapshot,`--${forbidden}`,'secret'
    ]);
    assert.equal(verify.status,1);
    assert.match(verify.stderr,/secret input .* forbidden/i);
  }
});

test('publisher trust transitions reject stale timestamps, repeated enrollment and invalid key changes',()=>{
  const first=generateKeyPairSync('ed25519');
  const second=generateKeyPairSync('ed25519');
  const enroll=createPublisherTrustEvent({
    publisher:'release-registry',publicKey:first.publicKey,action:'enroll',
    configuredBy:'release-policy',configuredAt:'2026-10-03T21:30:00.000Z'
  });

  assert.throws(()=>createPublisherTrustEvent({
    publisher:'release-registry',publicKey:first.publicKey,action:'enroll',
    configuredBy:'release-policy',configuredAt:'2026-10-03T21:31:00.000Z',previousEvent:enroll
  }),/Enroll may only be the first/);

  assert.throws(()=>createPublisherTrustEvent({
    publisher:'release-registry',publicKey:first.publicKey,action:'rotate',
    configuredBy:'release-policy',configuredAt:'2026-10-03T21:31:00.000Z',previousEvent:enroll
  }),/different publisher key/);

  const staleRotate=createPublisherTrustEvent({
    publisher:'release-registry',publicKey:second.publicKey,action:'rotate',
    configuredBy:'release-policy',configuredAt:'2026-10-03T21:29:00.000Z',previousEvent:enroll
  });
  const historyPath=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'omegavault-publisher-trust-stale-')),'history.json');
  fs.writeFileSync(historyPath,JSON.stringify([enroll,staleRotate]));
  const snapshotPath=`${historyPath}.snapshot.json`;
  fs.writeFileSync(snapshotPath,JSON.stringify({
    schema:'omegavault.publisher-key-trust-history-snapshot.v1',
    publisher:'release-registry',
    eventCount:2,
    headSha256:staleRotate.sha256,
    currentKeySpkiSha256:staleRotate.publicKeySpkiSha256,
    status:'trusted',
    authority:{
      publisherTrust:false,reviewerTrust:false,anchoringAuthorityTrust:false,chainMaturity:false,
      chainPromotion:false,evidencePromotion:false,deploymentAuthority:false,walletAuthority:false,
      scope:'publisher-key-trust-history-integrity-only'
    },
    sha256:'00'.repeat(32)
  }));
  const verified=run('scripts/verify-publisher-trust-history.js',['--history',historyPath,'--snapshot',snapshotPath]);
  assert.equal(verified.status,1);
});
