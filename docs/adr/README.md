# Architecture Decision Records

Store durable design decisions in this directory.

Use an ADR when a decision changes how future contributors should reason about the system, such as:

- auth model
- persistence model
- live automation safety gates
- deployment topology
- API contract shape
- data semantics for Meta metrics

## File naming

```text
0001-short-decision-title.md
0002-another-decision.md
```

## Template

```markdown
# ADR-0001: Decision title

## Status

Accepted | Superseded | Proposed

## Context

What problem or constraint forced this decision?

## Decision

What did we choose?

## Consequences

What becomes easier, harder, or riskier because of this?

## Related

- Links to issues, PRs, docs, or plans.
```

Keep ADRs short and factual. Do not use ADRs as implementation plans.
