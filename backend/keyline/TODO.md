# Keyline follow-ups

## Reference digest for the digest law

`laws::digest_identifies_the_set` upstream also compares the store's digest with an independently computed `set_digest`.
Go digests cover opaque fact IDs and authority fields, so they cannot equal upstream's, and `digestIdentifiesTheSet` in
[keylinetest/conformance/laws.go](keylinetest/conformance/laws.go) checks only order independence and that dropping a
fact changes the digest. Restore an expected-value check with either a Go reference digest computed independently of the
stores, or fixed input and digest vectors.

## Content-addressed fact IDs

Fact IDs are opaque strings, so a digest must hash authority fields as well as IDs, and two facts with one ID and
different contents cannot be told apart. Evaluate deriving IDs from content instead, as upstream does with certificate
hashes. This is a design decision, separate from the digest work above. It needs answers for:

- the canonical encoding a fact is hashed in;
- which fields define a fact's identity, and whether Seed blob provenance belongs in it;
- compatibility and migration of existing IDs, including revocation targets that name delegations by ID;
- whether interoperability with upstream certificates is a requirement.

## Grant, revocation, and rotation workflows

Port upstream's workflows once Seed supports revocations: grants refused above the issuer's effective power, member
revocation with adoption of the removed member's delegations at the power each conveyed, and admin rotation. Upstream
implements them in `keyhive_core` (`add_member`, `revoke_member`), described in the Integration section of
`design/keyline/implementation.md`. Until then, applications compose authenticated batches themselves, following the
README's admin rotation recipe.
