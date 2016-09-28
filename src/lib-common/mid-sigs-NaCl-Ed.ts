/*
 Copyright (C) 2015 3NSoft Inc.
 
 This program is free software: you can redistribute it and/or modify it under
 the terms of the GNU General Public License as published by the Free Software
 Foundation, either version 3 of the License, or (at your option) any later
 version.
 
 This program is distributed in the hope that it will be useful, but
 WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 See the GNU General Public License for more details.
 
 You should have received a copy of the GNU General Public License along with
 this program. If not, see <http://www.gnu.org/licenses/>. */

/**
 * This library handles signing and verification of signatures, used
 * in MailerId.
 */

import * as nacl from "ecma-nacl";
import * as jwk from "./jwkeys";
import { base64, utf8 } from '../lib-common/buffer-utils';

/**
 * This enumerates MailerId's different use-roles of keys, involved in
 * establishing a trust.
 */
export let KEY_USE = {
	/**
	 * This is a MailerId trust root.
	 * It signs certificate for itself, and it signs certificates for provider
	 * keys, which have shorter life span, than the root.
	 * Root may revoke itself, and may revoke provider key.
	 */
	ROOT: "mid-root",
	/**
	 * This is a provider key, which is used to certify users' signing keys.
	 */
	PROVIDER: "mid-provider",
	/**
	 * With this key, MailerId user signs assertions and mail keys.
	 */
	SIGN: "mid-sign",
}
Object.freeze(KEY_USE);

export interface Keypair {
	pkey: jwk.JsonKey;
	skey: jwk.Key;
}

function genSignKeyPair(use: string, kidLen: number, random: nacl.GetRandom,
		arrFactory?: nacl.arrays.Factory): Keypair {
	let pair = nacl.signing.generate_keypair(random(32), arrFactory);
	let pkey: jwk.JsonKey = {
		use: use,
		alg: nacl.signing.JWK_ALG_NAME,
		kid: base64.pack(random(kidLen)),
		k: base64.pack(pair.pkey)
	};
	let skey: jwk.Key = {
		use: pkey.use,
		alg: pkey.alg,
		kid: pkey.kid,
		k: pair.skey
	}
	return { pkey: pkey, skey: skey };
}

function makeCert(pkey: jwk.JsonKey, principalAddr: string,
		issuer: string, issuedAt: number, expiresAt: number,
		signKey: jwk.Key, arrFactory?: nacl.arrays.Factory): jwk.SignedLoad {
	if (signKey.alg !== nacl.signing.JWK_ALG_NAME) { throw new Error(
			"Given signing key is used with another algorithm."); }
	let cert: jwk.KeyCert = {
		cert: {
			publicKey: pkey,
			principal: { address: principalAddr }
		},
		issuer: issuer,
		issuedAt: issuedAt,
		expiresAt: expiresAt
	};
	let certBytes = utf8.pack(JSON.stringify(cert));
	let sigBytes = nacl.signing.signature(certBytes, signKey.k, arrFactory);
	return {
		alg: signKey.alg,
		kid: signKey.kid,
		sig: base64.pack(sigBytes),
		load: base64.pack(certBytes)
	};
}

export module idProvider {

	export let KID_BYTES_LENGTH = 9;

	export let MAX_USER_CERT_VALIDITY = 24*60*60;
	
	export function makeSelfSignedCert(address: string, validityPeriod: number,
			sjkey: jwk.JsonKey, arrFactory?: nacl.arrays.Factory):
			jwk.SignedLoad {
		let skey = jwk.keyFromJson(sjkey, KEY_USE.ROOT,
			nacl.signing.JWK_ALG_NAME, nacl.signing.SECRET_KEY_LENGTH);
		let pkey: jwk.JsonKey = {
			use: sjkey.use,
			alg: sjkey.alg,
			kid: sjkey.kid,
			k: base64.pack(nacl.signing.extract_pkey(skey.k))
		};
		let now = Math.floor(Date.now()/1000);
		return makeCert(pkey, address, address,
			now, now+validityPeriod, skey, arrFactory);
	}
	
	/**
	 * One should keep MailerId root key offline, as this key is used only to
	 * sign provider keys, which have to work online.
	 * @param address is an address of an issuer
	 * @param validityPeriod validity period of a generated self-signed
	 * certificate in milliseconds
	 * @param random
	 * @param arrFactory optional array factory
	 * @return Generated root key and a self-signed certificate for respective
	 * public key.
	 */
	export function generateRootKey(address: string, validityPeriod: number,
			random: nacl.GetRandom, arrFactory?: nacl.arrays.Factory):
			{ cert: jwk.SignedLoad; skey: jwk.JsonKey } {
		if (validityPeriod < 1) { throw new Error("Illegal validity period."); }
		let rootPair = genSignKeyPair(KEY_USE.ROOT,
				KID_BYTES_LENGTH, random, arrFactory);
		let now = Math.floor(Date.now()/1000);
		let rootCert = makeCert(rootPair.pkey, address, address,
				now, now+validityPeriod, rootPair.skey, arrFactory);
		return { cert: rootCert, skey: jwk.keyToJson(rootPair.skey) };
	}
	
	/**
	 * @param address is an address of an issuer
	 * @param validityPeriod validity period of a generated self-signed
	 * certificate in seconds
	 * @param rootJKey root key in json format
	 * @param random
	 * @param arrFactory optional array factory
	 * @return Generated provider's key and a certificate for a respective
	 * public key.
	 */
	export function generateProviderKey(address: string, validityPeriod: number,
			rootJKey: jwk.JsonKey, random: nacl.GetRandom,
			arrFactory?: nacl.arrays.Factory):
			{ cert: jwk.SignedLoad; skey: jwk.JsonKey } {
		if (validityPeriod < 1) { throw new Error("Illegal validity period."); }
		let rootKey = jwk.keyFromJson(rootJKey, KEY_USE.ROOT,
				nacl.signing.JWK_ALG_NAME, nacl.signing.SECRET_KEY_LENGTH);
		let provPair = genSignKeyPair(KEY_USE.PROVIDER,
				KID_BYTES_LENGTH, random, arrFactory);
		let now = Math.floor(Date.now()/1000);
		let rootCert = makeCert(provPair.pkey, address, address,
				now, now+validityPeriod, rootKey, arrFactory);
		return { cert: rootCert, skey: jwk.keyToJson(provPair.skey) };
	}

	/**
	 * MailerId providing service should use this object to generate certificates.
	 */
	export interface IdProviderCertifier {
		/**
		 * @param publicKey
		 * @param address
		 * @param validFor (optional)
		 * @return certificate for a given key
		 */
		certify(publicKey: jwk.JsonKey, address: string,
				validFor?: number): jwk.SignedLoad;
		/**
		 * This securely erases internal key.
		 * Call this function, when certifier is no longer needed.
		 */
		destroy(): void;
	}

	/**
	 * @param issuer is a domain of certificate issuer, at which issuer's public
	 * key can be found to check the signature
	 * @param validityPeriod is a default validity period in seconds, for
	 * which certifier shall be making certificates
	 * @param signJKey is a certificates signing key
	 * @param arrFactory is an optional array factory
	 * @return MailerId certificates generator, which shall be used on identity
	 * provider's side
	 */
	export function makeIdProviderCertifier(issuer: string,
			validityPeriod: number, signJKey: jwk.JsonKey,
			arrFactory?: nacl.arrays.Factory): IdProviderCertifier {
		if (!issuer) { throw new Error("Given issuer is illegal."); } 
		if ((validityPeriod < 1) || (validityPeriod > MAX_USER_CERT_VALIDITY)) {
			throw new Error("Given certificate validity is illegal.");
		}
		let signKey = jwk.keyFromJson(signJKey, KEY_USE.PROVIDER,
				nacl.signing.JWK_ALG_NAME, nacl.signing.SECRET_KEY_LENGTH);
		signJKey = null;
		if (!arrFactory) {
			arrFactory = nacl.arrays.makeFactory();
		}
		return {
			certify: (publicKey: jwk.JsonKey, address: string,
					validFor?: number): jwk.SignedLoad => {
				if (!signKey) { throw new Error(
						"Certifier is already destroyed."); }
				if (publicKey.use !== KEY_USE.SIGN) { throw new Error(
						"Given public key is not used for signing."); }
				if ('number' === typeof validFor) {
					if (validFor > validityPeriod) {
						validFor = validityPeriod;
					} else if (validFor < 0) {
						new Error("Given certificate validity is illegal.");
					}
				} else {
					validFor = validityPeriod;
				}
				let now = Math.floor(Date.now()/1000);
				return makeCert(publicKey, address, issuer,
						now, now+validFor, signKey, arrFactory);
			},
			destroy: (): void => {
				if (!signKey) { return; }
				nacl.arrays.wipe(signKey.k);
				signKey = null;
				arrFactory.wipeRecycled();
				arrFactory = null;
			}
		};
	}
	
}
Object.freeze(idProvider);

export interface AssertionLoad {
	user: string;
	rpDomain: string;
	sessionId: string;
	issuedAt: number;
	expiresAt: number;
}

export interface CertsChain {
	user: jwk.SignedLoad;
	prov: jwk.SignedLoad;
	root: jwk.SignedLoad;
}

export module relyingParty {

	function verifyCertAndGetPubKey(signedCert: jwk.SignedLoad, use: string,
			validAt: number, arrFactory: nacl.arrays.Factory,
			issuer?: string, issuerPKey?: jwk.Key):
			{ pkey: jwk.Key; address:string; } {
		let cert = jwk.getKeyCert(signedCert);
		if ((validAt < cert.issuedAt) || (cert.expiresAt <= validAt)) {
			throw new Error("Certificate is not valid at a given moment.");
		}
		if (issuer) {
			if (!issuerPKey) { throw new Error("Missing issuer key."); }
			if ((cert.issuer !== issuer) ||
					(signedCert.kid !== issuerPKey.kid)) {
				throw new Error(use+" certificate is not signed by issuer key.");
			}
		}
		let pkey = jwk.keyFromJson(cert.cert.publicKey, use,
				nacl.signing.JWK_ALG_NAME, nacl.signing.PUBLIC_KEY_LENGTH);
		let certOK = nacl.signing.verify(
			base64.open(signedCert.sig), base64.open(signedCert.load),
			(issuer ? issuerPKey.k : pkey.k), arrFactory);
		if (!certOK) { throw new Error(use+" certificate failed validation."); }
		return { pkey: pkey, address: cert.cert.principal.address };
	}
	
	/**
	 * @param certs is a chain of certificate to be verified.
	 * @param rootAddr is MailerId service's domain.
	 * @param validAt is an epoch time moment (in second), at which user
	 * certificate must be valid. Provider certificate must be valid at
	 * creation of user's certificate. Root certificate must be valid at
	 * creation of provider's certificate.
	 * @return user's MailerId signing key with user's address.
	 */
	export function verifyChainAndGetUserKey(certs: CertsChain,
			rootAddr: string, validAt: number, arrFactory?: nacl.arrays.Factory):
			{ pkey: jwk.Key; address:string; } {
		// check root and get the key
		let provCertIssueMoment = jwk.getKeyCert(certs.prov).issuedAt;
		let root = verifyCertAndGetPubKey(
				certs.root, KEY_USE.ROOT, provCertIssueMoment, arrFactory);
		if (rootAddr !== root.address) { throw new Error(
				"Root's address is different from a given one."); }
		// check provider and get the key
		let userCertIssueMoment = jwk.getKeyCert(certs.user).issuedAt;
		let provider = verifyCertAndGetPubKey(certs.prov, KEY_USE.PROVIDER,
				userCertIssueMoment, arrFactory, root.address, root.pkey);
		// check that provider cert comes from the same issuer as root
		if (root.address !== provider.address) { throw new Error(
				"Provider's address is different from that of root."); }
		// check user certificate and get the key
		return verifyCertAndGetPubKey(certs.user, KEY_USE.SIGN,
				validAt, arrFactory, provider.address, provider.pkey);
	}
	
	export interface AssertionInfo {
		relyingPartyDomain: string;
		sessionId: string;
		user: string;
	}
	
	export function verifyAssertion(midAssertion: jwk.SignedLoad,
			certChain: CertsChain, rootAddr: string,
			validAt: number, arrFactory?: nacl.arrays.Factory): AssertionInfo {
		let userInfo = verifyChainAndGetUserKey(
			certChain, rootAddr, validAt, arrFactory);
		let loadBytes = base64.open(midAssertion.load);
		if (!nacl.signing.verify(base64.open(midAssertion.sig),
				loadBytes, userInfo.pkey.k, arrFactory)) {
			throw new Error("Assertion fails verification.");
		}
		let assertion: AssertionLoad = JSON.parse(utf8.open(loadBytes));
		if (assertion.user !== userInfo.address) { throw new Error(
				"Assertion is for one user, while chain is for another."); }
		if (!assertion.sessionId) { throw new Error("Assertion is malformed."); }
		if (Math.abs(validAt - assertion.issuedAt) >
				(assertion.expiresAt - assertion.issuedAt)) {
			throw new Error("Assertion is not valid at a given moment.");
		}
		return {
			sessionId: assertion.sessionId,
			relyingPartyDomain: assertion.rpDomain,
			user: userInfo.address
		};
	}
	
	/**
	 * This function does verification of a single certificate with known
	 * signing key.
	 * If your task requires verification starting with principal's MailerId,
	 * use verifyPubKey function that also accepts and checks MailerId
	 * certificates chain.
	 * @param keyCert is a certificate that should be checked
	 * @param principalAddress is an expected principal's address in a given
	 * certificate. Exception is thrown, if certificate does not match this
	 * expectation.
	 * @param signingKey is a public key, with which given certificate is
	 * validated cryptographically. Exception is thrown, if crypto-verification
	 * fails.
	 * @param validAt is an epoch time moment (in second), for which verification
	 * should be done.
	 * @param arrFactory is an optional array factory.
	 * @return a key from a given certificate.
	 */
	export function verifyKeyCert(keyCert: jwk.SignedLoad,
			principalAddress: string, signingKey: jwk.Key, validAt: number,
			arrFactory?: nacl.arrays.Factory): jwk.JsonKey {
		if (!nacl.signing.verify(base64.open(keyCert.sig),
				base64.open(keyCert.load), signingKey.k, arrFactory)) {
			throw new Error("Key certificate fails verification.");
		}
		let cert = jwk.getKeyCert(keyCert);
		if (cert.cert.principal.address !== principalAddress) { throw new Error(
				"Key certificate is for incorrect user."); }
		if ((validAt < cert.issuedAt) || (cert.expiresAt <= validAt)) {
			throw new Error("Certificate is not valid at a given moment.");
		}
		return cert.cert.publicKey;
	}
	
	/**
	 * @param pubKeyCert certificate with a public key, that needs to be
	 * verified.
	 * @param principalAddress is an expected principal's address in both key
	 * certificate, and in MailerId certificate chain. Exception is thrown,
	 * if certificate does not match this expectation.
	 * @param certChain is MailerId certificate chain for named principal.
	 * @param rootAddr is MailerId root's domain.
	 * @param validAt is an epoch time moment (in second), for which key
	 * certificate verification should be done.
	 * @param arrFactory is an optional array factory.
	 * @return a key from a given certificate.
	 */
	export function verifyPubKey(pubKeyCert: jwk.SignedLoad,
			principalAddress: string, certChain: CertsChain, rootAddr: string,
			validAt: number, arrFactory?: nacl.arrays.Factory): jwk.JsonKey {
		let chainValidityMoment = jwk.getKeyCert(pubKeyCert).issuedAt;
		let principalInfo = verifyChainAndGetUserKey(
			certChain, rootAddr, chainValidityMoment, arrFactory);
		if (principalInfo.address !== principalAddress) { throw new Error(
			"MailerId certificate chain is for incorrect user."); }
		return verifyKeyCert(pubKeyCert, principalAddress,
			principalInfo.pkey, validAt, arrFactory);
	}
	
}
Object.freeze(relyingParty);


function correlateSKeyWithItsCert(skey: jwk.Key, cert: jwk.KeyCert): void {
	let pkey = jwk.keyFromJson(cert.cert.publicKey, skey.use,
			nacl.signing.JWK_ALG_NAME, nacl.signing.PUBLIC_KEY_LENGTH);
	if ( ! ((pkey.kid === skey.kid) &&
			(pkey.use === skey.use) &&
			(pkey.alg === skey.alg) &&
			nacl.compareVectors(nacl.signing.extract_pkey(skey.k), pkey.k))) {
		throw new Error("Key does not correspond to certificate.");
	}
}

export module user {

	/**
	 * This is used by user of MailerId to create assertion that prove user's
	 * identity.
	 */
	export interface MailerIdSigner {
		address: string;
		userCert: jwk.SignedLoad;
		providerCert: jwk.SignedLoad;
		issuer: string;
		certExpiresAt: number;
		validityPeriod: number;
		/**
		 * @param rpDomain
		 * @param sessionId
		 * @param validFor (optional)
		 * @return signed assertion with a given sessionId string.
		 */
		generateAssertionFor(rpDomain: string, sessionId: string,
				validFor?: number): jwk.SignedLoad;
		/**
		 * @param pkey
		 * @param validFor
		 * @return signed certificate with a given public key.
		 */
		certifyPublicKey(pkey: jwk.JsonKey, validFor: number): jwk.SignedLoad;
		/**
		 * Makes this AssertionSigner not usable by wiping its secret key.
		 */
		destroy(): void;
	}

	export let KID_BYTES_LENGTH = 9;

	export let MAX_SIG_VALIDITY = 30*60;
	
	export function generateSigningKeyPair(random: nacl.GetRandom,
			arrFactory?: nacl.arrays.Factory): Keypair {
		return genSignKeyPair(KEY_USE.SIGN, KID_BYTES_LENGTH,
				random, arrFactory);
	}
	
	/**
	 * @param signKey which will be used to sign assertions/keys. Note that
	 * this key shall be wiped, when signer is destroyed, as key is neither
	 * long-living, nor should be shared.  
	 * @param cert is user's certificate, signed by identity provider.
	 * @param provCert is provider's certificate, signed by respective mid root.
	 * @param assertionValidity is an assertion validity period in seconds
	 * @param arrFactory is an optional array factory
	 * @return signer for user of MailerId to generate assertions, and to sign
	 * keys.
	 */
	export function makeMailerIdSigner(signKey: jwk.Key,
			userCert: jwk.SignedLoad, provCert: jwk.SignedLoad,
			assertionValidity = user.MAX_SIG_VALIDITY,
			arrFactory?: nacl.arrays.Factory): MailerIdSigner {
		let certificate = jwk.getKeyCert(userCert);
		if (signKey.use !== KEY_USE.SIGN) { throw new Error(
				"Given key "+signKey.kid+" has incorrect use: "+signKey.use); }
		correlateSKeyWithItsCert(signKey, certificate);
		if (('number' !== typeof assertionValidity) || (assertionValidity < 1) ||
				(assertionValidity > user.MAX_SIG_VALIDITY)) {
			throw new Error("Given assertion validity is illegal: "+
				assertionValidity);
		}
		if (!arrFactory) {
			arrFactory = nacl.arrays.makeFactory();
		}
		let signer: MailerIdSigner = {
			address: certificate.cert.principal.address,
			userCert: userCert,
			providerCert: provCert,
			issuer: certificate.issuer,
			certExpiresAt: certificate.expiresAt,
			validityPeriod: assertionValidity,
			generateAssertionFor: (rpDomain: string, sessionId: string,
					validFor?: number): jwk.SignedLoad => {
				if (!signKey) { throw new Error("Signer is already destroyed."); }
				if ('number' === typeof validFor) {
					if (validFor > assertionValidity) {
						validFor = assertionValidity;
					} else if (validFor < 0) {
						new Error("Given certificate validity is illegal.");
					}
				} else {
					validFor = assertionValidity;
				}
				let now = Math.floor(Date.now()/1000);
				if (now <= certificate.issuedAt) {
					now = certificate.issuedAt + 1;
				}
				if (now >= certificate.expiresAt) { throw new Error(
						"Signing key has already expiried."); }
				let assertion: AssertionLoad = {
					rpDomain: rpDomain,
					sessionId: sessionId,
					user: certificate.cert.principal.address,
					issuedAt: now,
					expiresAt: now+validFor
				}
				let assertionBytes = utf8.pack(JSON.stringify(assertion));
				let sigBytes = nacl.signing.signature(
						assertionBytes, signKey.k, arrFactory);
				return {
					alg: signKey.alg,
					kid: signKey.kid,
					sig: base64.pack(sigBytes),
					load: base64.pack(assertionBytes)
				}
			},
			certifyPublicKey: (pkey: jwk.JsonKey, validFor: number):
					jwk.SignedLoad => {
				if (!signKey) { throw new Error("Signer is already destroyed."); }
				if (validFor < 0) {
					new Error("Given certificate validity is illegal.");
				}
				let now = Math.floor(Date.now()/1000);
				if (now >= certificate.expiresAt) { throw new Error(
						"Signing key has already expiried."); }
				return makeCert(pkey, certificate.cert.principal.address,
							certificate.cert.principal.address,
							now, now+validFor, signKey, arrFactory);
			},
			destroy: (): void => {
				if (!signKey) { return; }
				nacl.arrays.wipe(signKey.k);
				signKey = null;
				arrFactory.wipeRecycled();
				arrFactory = null;
			}
		};
		Object.freeze(signer);
		return signer;
	}
	
}
Object.freeze(user);

Object.freeze(exports);