// Package keylinetest checks keyline.Store implementations. It runs Keyline's
// store contract and authority scenarios through the public API, so every
// store is held to the same behavior. The conformance subpackage runs the
// ported upstream laws.
//
// A store package calls Run and conformance.Run from its tests, the
// conformance fuzz targets, and BenchmarkEvaluation from its benchmarks.
// Store-specific behavior, such as locking or SQL schema, belongs in the store
// package's own tests.
package keylinetest

import (
	"testing"

	"seed/backend/keyline"
)

// NewStore returns a new, empty store owned by one test. It may register
// cleanup with tb.
type NewStore func(tb testing.TB) keyline.Store

// Run runs every store-dependent Keyline test as a subtest of t, using a fresh
// store from newStore wherever a test needs one.
func Run(t *testing.T, newStore NewStore) {
	for _, test := range []struct {
		name string
		run  func(*testing.T, NewStore)
	}{
		{"BatchContract", testBatchContract},
		{"Apply", testApply},
		{"InvalidFacts", testInvalidFacts},
		{"StoreIdentityAndIsolation", testStoreIdentityAndIsolation},
		{"ConcurrentStore", testConcurrentStore},
		{"ReadTransactions", testReadTransactions},
		{"Enumeration", testEnumeration},
		{"NodeMentionArrivalOrder", testNodeMentionArrivalOrder},
		{"NodeMentionUpdatesAndRollback", testNodeMentionUpdatesAndRollback},
		{"NodeMentionTieAcrossReplicas", testNodeMentionTieAcrossReplicas},
		{"EvaluationScenarios", testEvaluationScenarios},
		{"WriteRootedRootEdgeIsIrrevocable", testWriteRootedRootEdgeIsIrrevocable},
		{"SeniorRoleAdminRevokesInsideJuniorRole", testSeniorRoleAdminRevokesInsideJuniorRole},
		{"SupplyIsDaisyChained", testSupplyIsDaisyChained},
		{"GiftCertAttackFollowsLiveness", testGiftCertAttackFollowsLiveness},
		{"PinnedDelegationAnswersToTheRole", testPinnedDelegationAnswersToTheRole},
		{"CaretakerAdminSeversDownstreamButNotTheSupply", testCaretakerAdminSeversDownstreamButNotTheSupply},
		{"RevocationCoverageUnion", testRevocationCoverageUnion},
		{"ReissueAndFormerAdmin", testReissueAndFormerAdmin},
		{"OldRevocationGainsCoverage", testOldRevocationGainsCoverage},
		{"SetSemantics", testSetSemantics},
		{"QueryErrorsDeny", testQueryErrorsDeny},
		{"QueriesIgnoreUnrelatedAuthority", testQueriesIgnoreUnrelatedAuthority},
		{"DuplicateIteratorRows", testDuplicateIteratorRows},
		{"WideEvaluation", testWideEvaluation},
		{"DeepAuthority", testDeepAuthority},
		{"PartialReplication", testPartialReplication},
		{"ClosureEmptyAndNodeOnly", testClosureEmptyAndNodeOnly},
		{"PositiveAndSubsetQueries", testPositiveAndSubsetQueries},
		{"DigestIdentity", testDigestIdentity},
		{"ReplicationFailures", testReplicationFailures},
		{"RotationEscapesFrozenReach", testRotationEscapesFrozenReach},
		{"StewardRotationLeavesFormerOfficersNothing", testStewardRotationLeavesFormerOfficersNothing},
		{"RotationRevocationContinuity", testRotationRevocationContinuity},
		{"RotationCannotEscapeSubjectAdmin", testRotationCannotEscapeSubjectAdmin},
		{"RotationClosureReplica", testRotationClosureReplica},
	} {
		t.Run(test.name, func(t *testing.T) { test.run(t, newStore) })
	}
}
