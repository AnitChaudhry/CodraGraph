// Public SDK surface for codragraph-harness.
//
// Populated incrementally by phase tasks:
//   - contracts: ./harness/interface, ./proposer/interface, ./inference/interface
//   - algorithm: ./algorithm
//   - filesystem: ./filesystem
//   - pareto:    ./pareto
//   - evaluator: ./evaluator/runner, ./evaluator/score
//   - seeds:     ./harness/seeds/*
//   - swarm:     ./swarm/* (Phase 3)
//   - moat:      ./moat/*  (Phase 4 × Phase 3 — versioned recipe memory)
//   - cli:       ./cli/main (binary entry — not re-exported here)

export * from './moat/index.js';
