package core

import (
	"bytes"
	"fmt"
	"seed/backend/util/slip10"
	"strings"

	"github.com/tyler-smith/go-bip39"
)

// KeyPairFromMnemonic returns a key pair (priv + pub) derived
// from the entropy associated to the given mnemonics and a passphrase.
// Different passphrase (null passphrase is a valid passphrase) lead to
// different and valid accounts.
func KeyPairFromMnemonic(m []string, passphrase string) (*KeyPair, error) {
	seed, err := bip39.NewSeedWithErrorChecking(strings.Join(m, " "), passphrase)
	if err != nil {
		return nil, fmt.Errorf("unable to derive a seed from mnemonics and password: %w", err)
	}

	return KeyPairFromSeed(seed)
}

// keyDerivationPath value according to SLIP-10 and BIP-44.
// 104109 is the concatenation of Unicode code point values for 'hm' - stands for Hypermedia.
// The first zero segment can be incremented to derive multiple accounts eventually.
const keyDerivationPath = "m/44'/104109'/0'"

// KeyPairFromSeed creates an account key pair from a previously generated entropy.
func KeyPairFromSeed(rand []byte) (*KeyPair, error) {
	slipSeed, err := slip10.DeriveForPath(keyDerivationPath, rand)
	if err != nil {
		return nil, err
	}

	return GenerateKeyPair(Ed25519, bytes.NewReader(slipSeed.Seed()))
}

// NewBIP39Mnemonic creates a new random BIP-39 compatible mnemonic words.
func NewBIP39Mnemonic(length uint32) ([]string, error) {
	entropyLen := 0
	switch length {
	case 12:
		entropyLen = 128
	case 15:
		entropyLen = 160
	case 18:
		entropyLen = 192
	case 21:
		entropyLen = 224
	case 24:
		entropyLen = 256
	default:
		return nil, fmt.Errorf("mnemonic length must be 12 | 15 | 18 | 21 | 24 words")
	}
	entropy, err := bip39.NewEntropy(entropyLen)
	if err != nil {
		return nil, fmt.Errorf("unable to generate random seed: %w", err)
	}
	mnemonic, err := bip39.NewMnemonic(entropy)
	if err != nil {
		return nil, fmt.Errorf("unable to generate mnemonics from random seed: %w", err)
	}

	return strings.Split(mnemonic, " "), nil
}
