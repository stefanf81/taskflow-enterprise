const assert = require('node:assert/strict');
const { createHash, generateKeyPairSync, privateEncrypt, constants } = require('node:crypto');
const { createRequire } = require('node:module');
const { test } = require('node:test');

// Exercise the actual copies used by Expo, including separately nested installs.
const consumers = ['@expo/cli', '@expo/code-signing-certificates'];
const digest = createHash('sha256').update('TaskFlow certificate verification').digest();

function encodeDigestInfo(forge, { includeNull, nestedGarbage = false, outerGarbage = false }) {
  const { asn1 } = forge;
  const universal = asn1.Class.UNIVERSAL;
  const algorithm = [
    asn1.create(universal, asn1.Type.OID, false, asn1.oidToDer(forge.oids.sha256).getBytes()),
  ];
  if (includeNull) {
    algorithm.push(asn1.create(universal, asn1.Type.NULL, false, ''));
  }
  if (nestedGarbage) {
    algorithm.push(asn1.create(universal, asn1.Type.OCTETSTRING, false, 'unconsumed bytes'));
  }
  const sequence = [
    asn1.create(universal, asn1.Type.SEQUENCE, true, algorithm),
    asn1.create(universal, asn1.Type.OCTETSTRING, false, digest.toString('latin1')),
  ];
  if (outerGarbage) {
    sequence.push(asn1.create(universal, asn1.Type.OCTETSTRING, false, 'unconsumed bytes'));
  }
  return Buffer.from(
    asn1.toDer(asn1.create(universal, asn1.Type.SEQUENCE, true, sequence)).getBytes(),
    'latin1',
  );
}

for (const exponent of [3, 65537]) {
  // Keys exist only in memory; no private-key fixtures or credentials are stored.
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicExponent: exponent,
  });

  for (const consumer of consumers) {
    const forge = createRequire(require.resolve(`${consumer}/package.json`))('node-forge');
    const verifier = forge.pki.publicKeyFromPem(publicKey.export({ type: 'spki', format: 'pem' }));
    const signDigestInfo = (options) =>
      privateEncrypt(
        { key: privateKey, padding: constants.RSA_PKCS1_PADDING },
        encodeDigestInfo(forge, options),
      ).toString('latin1');
    const prefix = `${consumer}, RSA e=${exponent}`;

    for (const includeNull of [false, true]) {
      test(`${prefix}: accepts valid SHA-256 DigestInfo (NULL=${includeNull})`, () => {
        assert.equal(
          verifier.verify(digest.toString('latin1'), signDigestInfo({ includeNull })),
          true,
        );
      });

      // CVE-2026-85393: the vulnerable implementation accepts these real RSA
      // signatures despite extra elements inside the nested DigestAlgorithm.
      test(`${prefix}: rejects nested DigestAlgorithm garbage (NULL=${includeNull})`, () => {
        const signature = signDigestInfo({ includeNull, nestedGarbage: true });
        assert.throws(
          () => verifier.verify(digest.toString('latin1'), signature),
          /valid RSASSA-PKCS1-v1_5 DigestInfo/,
        );
      });
    }

    test(`${prefix}: still rejects outer DigestInfo garbage`, () => {
      const signature = signDigestInfo({ includeNull: true, outerGarbage: true });
      assert.throws(
        () => verifier.verify(digest.toString('latin1'), signature),
        /valid RSASSA-PKCS1-v1_5 DigestInfo/,
      );
    });

    test(`${prefix}: rejects a signature for a different digest`, () => {
      const wrongDigest = createHash('sha256').update('different message').digest('latin1');
      assert.equal(verifier.verify(wrongDigest, signDigestInfo({ includeNull: true })), false);
    });
  }
}
