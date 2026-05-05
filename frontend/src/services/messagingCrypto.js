import sodium from "libsodium-wrappers-sumo";

const STORAGE_KEY = "lulit_secure_messaging_identity_v2";
const PREKEY_POOL_SIZE = 6;

export const MESSAGING_SECURITY_MODE = {
  STANDARD: "STANDARD",
  PRIVATE: "PRIVATE"
};

function encode(bytes) {
  return sodium.to_base64(bytes, sodium.base64_variants.ORIGINAL);
}

function decode(value) {
  return sodium.from_base64(value, sodium.base64_variants.ORIGINAL);
}

function concatBytes(...items) {
  const totalLength = items.reduce((sum, item) => sum + item.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const item of items) {
    result.set(item, offset);
    offset += item.length;
  }
  return result;
}

function envelopeAad(header) {
  return sodium.from_string(JSON.stringify(header));
}

async function ensureCrypto() {
  await sodium.ready;
}

function loadRawIdentity() {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : null;
}

function saveRawIdentity(identity) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
}

function createOneTimePrekeyBundle() {
  const boxKeypair = sodium.crypto_box_keypair();
  return {
    id: crypto.randomUUID(),
    boxPublicKey: encode(boxKeypair.publicKey),
    boxPrivateKey: encode(boxKeypair.privateKey)
  };
}

async function createFreshIdentity() {
  const identityKeypair = sodium.crypto_box_keypair();
  const signingKeypair = sodium.crypto_sign_keypair();
  const oneTimePrekeys = [];

  for (let i = 0; i < PREKEY_POOL_SIZE; i += 1) {
    oneTimePrekeys.push(createOneTimePrekeyBundle());
  }

  return {
    schemaVersion: 2,
    encryptionPublicKey: encode(identityKeypair.publicKey),
    encryptionPrivateKey: encode(identityKeypair.privateKey),
    signingPublicKey: encode(signingKeypair.publicKey),
    signingPrivateKey: encode(signingKeypair.privateKey),
    oneTimePrekeys
  };
}

export async function ensureLocalMessagingIdentity() {
  await ensureCrypto();
  const existing = loadRawIdentity();
  if (existing?.schemaVersion === 2 && existing.signingPublicKey && existing.signingPrivateKey) {
    return existing;
  }

  const freshIdentity = await createFreshIdentity();
  saveRawIdentity(freshIdentity);
  return freshIdentity;
}

export async function buildIdentityRegistrationPayload() {
  const identity = await ensureLocalMessagingIdentity();
  return {
    encryptionPublicKey: identity.encryptionPublicKey,
    signingPublicKey: identity.signingPublicKey,
    oneTimePrekeys: identity.oneTimePrekeys.map((item) => ({
      id: item.id,
      boxPublicKey: item.boxPublicKey
    }))
  };
}

export async function createEncryptedEnvelope({
  plaintext,
  senderWallet,
  recipientWallet,
  recipientPrekey,
  securityMode = MESSAGING_SECURITY_MODE.STANDARD
}) {
  await ensureCrypto();
  const senderEphemeral = sodium.crypto_box_keypair();
  const kdfSalt = sodium.randombytes_buf(32);
  const classicalShared = sodium.crypto_scalarmult(
    senderEphemeral.privateKey,
    decode(recipientPrekey.boxPublicKey)
  );
  const wrappingKey = sodium.crypto_generichash(32, concatBytes(classicalShared, kdfSalt));

  const messageKey = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_KEYBYTES);
  const contentNonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
  const wrappingNonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
  const identity = await ensureLocalMessagingIdentity();

  const header = {
    version: 2,
    algorithm: "x25519-onetimeprekey+xchacha20poly1305+ed25519",
    securityMode,
    senderWallet: senderWallet.toLowerCase(),
    recipientWallet: recipientWallet.toLowerCase(),
    recipientPrekeyId: recipientPrekey.id,
    senderEphemeralPublicKey: encode(senderEphemeral.publicKey),
    senderSigningPublicKey: identity.signingPublicKey,
    kdfSalt: encode(kdfSalt),
    privacyFlags: {
      hideSenderPreview: securityMode === MESSAGING_SECURITY_MODE.PRIVATE,
      shortLivedPlaintext: securityMode === MESSAGING_SECURITY_MODE.PRIVATE,
      requireFreshWalletAuth: securityMode === MESSAGING_SECURITY_MODE.PRIVATE
    }
  };

  const aad = envelopeAad(header);
  const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    sodium.from_string(plaintext),
    aad,
    null,
    contentNonce,
    messageKey
  );
  const wrappedMessageKey = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    messageKey,
    aad,
    null,
    wrappingNonce,
    wrappingKey
  );

  const digest = sodium.crypto_generichash(32, concatBytes(aad, ciphertext));
  const detachedSignature = sodium.crypto_sign_detached(digest, decode(identity.signingPrivateKey));

  return {
    envelope: {
      ...header,
      contentNonce: encode(contentNonce),
      wrappingNonce: encode(wrappingNonce),
      wrappedMessageKey: encode(wrappedMessageKey),
      ciphertext: encode(ciphertext),
      detachedSignature: encode(detachedSignature)
    },
    envelopeDigest: encode(digest)
  };
}

export async function decryptEnvelope(envelope, expectedSenderSigningPublicKey = "") {
  await ensureCrypto();
  const identity = await ensureLocalMessagingIdentity();
  const prekeyIndex = identity.oneTimePrekeys.findIndex((item) => item.id === envelope.recipientPrekeyId);
  if (prekeyIndex < 0) {
    throw new Error("No matching one-time prekey found on this device");
  }

  const prekey = identity.oneTimePrekeys[prekeyIndex];
  const classicalShared = sodium.crypto_scalarmult(
    decode(prekey.boxPrivateKey),
    decode(envelope.senderEphemeralPublicKey)
  );
  const wrappingKey = sodium.crypto_generichash(32, concatBytes(classicalShared, decode(envelope.kdfSalt)));

  const header = {
    version: envelope.version,
    algorithm: envelope.algorithm,
    securityMode: envelope.securityMode || MESSAGING_SECURITY_MODE.STANDARD,
    senderWallet: envelope.senderWallet,
    recipientWallet: envelope.recipientWallet,
    recipientPrekeyId: envelope.recipientPrekeyId,
    senderEphemeralPublicKey: envelope.senderEphemeralPublicKey,
    senderSigningPublicKey: envelope.senderSigningPublicKey,
    kdfSalt: envelope.kdfSalt,
    privacyFlags: envelope.privacyFlags || {}
  };
  const aad = envelopeAad(header);
  const digest = sodium.crypto_generichash(32, concatBytes(aad, decode(envelope.ciphertext)));
  const signingKey = expectedSenderSigningPublicKey || envelope.senderSigningPublicKey;
  if (!signingKey) {
    throw new Error("Sender signing key is unavailable");
  }
  if (
    !sodium.crypto_sign_verify_detached(
      decode(envelope.detachedSignature),
      digest,
      decode(signingKey)
    )
  ) {
    throw new Error("Message signature verification failed");
  }

  const messageKey = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
    null,
    decode(envelope.wrappedMessageKey),
    aad,
    decode(envelope.wrappingNonce),
    wrappingKey
  );
  const plaintextBytes = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
    null,
    decode(envelope.ciphertext),
    aad,
    decode(envelope.contentNonce),
    messageKey
  );

  identity.oneTimePrekeys.splice(prekeyIndex, 1);
  while (identity.oneTimePrekeys.length < PREKEY_POOL_SIZE) {
    identity.oneTimePrekeys.push(createOneTimePrekeyBundle());
  }
  saveRawIdentity(identity);

  return sodium.to_string(plaintextBytes);
}
