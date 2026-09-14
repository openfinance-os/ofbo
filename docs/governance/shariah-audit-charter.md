# Internal Shari'ah audit charter & purification policy

> **ADOPT.** Mounted as `docs/governance/shariah-audit-charter.md`. This is the written constitution
> for the third line of the Shari'ah plane and for what happens to money that should never have been
> earned. It is a **paper control**, and it says so: nothing in this harness enforces a reporting
> line, and no gate can tell whether an audit was independent. What the gates check is that the
> people named here resolve in the identity registry, that `internal_audit.outsourced` is literally
> `false` in `docs/governance/issc-register.json`, and that the records this charter says will exist
> do exist and are bound to the change that produced them. Delete this file if you run no Islamic
> product — it governs nothing you have.
>
> **Nothing here rules on Shari'ah.** Every determination cited below is a scholar's, recorded as an
> `SR-*` row in `docs/governance/shariah-rulings.json`. Audit tests conformance to determinations
> already made. It does not make them, and neither does any agent, gate or reviewer in this bundle.

Replace every `ADOPT:` marker. A marker left in place is not a filled-in charter, and the adoption
report will say so.

---

## 1. Mandate

Internal Shari'ah audit provides independent assurance to the board that the institution's
activities conform to the determinations of the Internal Shari'ah Supervision Committee (the ISSC)
and to the pronouncements of the binding Shari'ah authority.

Its subject is **what was actually built and operated** — the executed contracts, the sequencing in
the system, the rates that were paid, the disclosures that reached customers — not the intent
recorded at approval. The second-line Shari'ah Compliance Function monitors conformance
continuously; the third line tests, periodically and independently, whether that monitoring is real.

- **Head of internal Shari'ah audit:** `ADOPT:` registry identity id holding `shariah-audit`
- **Charter approved by:** `ADOPT:` the board audit committee, with the date and minute reference
- **Review cadence:** `ADOPT:` how often this charter is re-approved (annually is the usual answer)

## 2. Independence, and the one rule with no exception

**Internal Shari'ah audit may never be outsourced.** Not co-sourced into a slot, not delegated to an
advisory firm, not shared with a group service that reports elsewhere. The function must be held by
an employee of the institution.

This is why `docs/governance/issc-register.json` carries `internal_audit.outsourced: false` as a
literal, and why the gate refuses a lead identity flagged `external` in
`docs/governance/identities.json`. Specialist support may be *engaged* — the head of function may buy
expertise the way any auditor does — but the mandate, the opinion and the accountability stay
in-house. An engagement letter is not a reporting line.

Two further separations that the harness can see only as distinct identities, and that the
institution has to actually operate:

| Must not be the same person as | Because |
|---|---|
| A member of the ISSC (`shariah-committee`) | Auditing a ruling you voted for is reviewing your own decision |
| The head of Shari'ah Compliance (`shariah-compliance`) | The third line's job includes testing whether the second line's monitoring works |

- **Reporting line:** the head of internal Shari'ah audit reports functionally to the **board audit
  committee**, administratively to `ADOPT:` (typically the chief audit executive). Reporting to the
  business that builds the products is the failure this line exists to prevent.
- **Right of access:** unrestricted access to systems, records, contracts, ISSC papers and staff.
  `ADOPT:` name the instrument that grants it.
- **Escalation:** `ADOPT:` the route to the board audit committee that does not pass through
  management, and how a disputed finding is recorded when management disagrees.

## 3. Scope

At minimum, each cycle covers:

1. **Structure conformance in execution.** Whether the contract the system actually executes matches
   the structure the ISSC approved — including **ownership sequencing**: that the institution owned
   the asset before it sold or leased it. This is where a synthetic implementation silently becomes
   a financing at interest, and it is invisible in the product documentation.
2. **Binding.** Whether each governed change that touched an Islamic product cited a live `SR-*`
   ruling, and whether the ruling it cited was issued against the structure that shipped.
3. **Profit distribution.** The runs in `docs/governance/profit-distribution.json`: allocation basis
   applied as approved, every PER/IRR movement carrying its own approval, expected and distributed
   rates disclosed as they were.
4. **Purification.** Section 4 below, end to end — identification through to the charity payment.
5. **Disclosure.** That what customers were told about the structure, the profit rate and any
   charge matches what the approved structure says.
6. **Findings closure.** Whether prior findings were remediated or quietly re-aged.

- **Cycle:** `ADOPT:` audit frequency per product line
- **Reporting:** `ADOPT:` to whom, how often, and in what form

## 4. Purification policy

Income the institution should never have earned is **quantified, approved, and given away**. It is
**never booked as income** — not in a suspense account that later releases to P&L, not netted
against a provision, not treated as a recovery.

Two sources, and they are different things:

| Source | What it is |
|---|---|
| **Non-compliant income** | Revenue arising from a transaction that turned out not to conform to the approved structure — a sequencing failure, an ineligible asset, a term applied that the ruling did not permit |
| **Late-payment charges** | Amounts charged on default. A charge that accrued to the institution on a late payment would be a return on the passage of time. It is collected as a deterrent and purified in full |

The process, and each step's record:

1. **Identify.** `ADOPT:` how a non-conforming transaction is detected and flagged.
2. **Quantify.** `ADOPT:` the basis for computing the amount to be purified, and who computes it.
3. **Approve.** The Shari'ah Compliance Function approves the quantification; the ISSC approves the
   treatment where the determination is not already covered by a live `SR-*` ruling. **An agent
   approves nothing here.**
4. **Segregate.** Held outside income from the moment it is identified. `ADOPT:` the account.
5. **Donate.** Paid to charity. `ADOPT:` the eligible-recipient policy, who selects, and the
   evidence retained for each payment.
6. **Disclose.** `ADOPT:` what is reported, to whom, and how often. Purification is not a secret
   line item — a period with no purification at all is a finding worth explaining, not a clean result.

**The customer never benefits from purification and neither does the institution.** A rebate of a
late-payment charge back to the defaulting customer turns a deterrent into a discount for defaulting;
booking it turns a penalty into revenue. It goes to charity.

> **Open Finance note.** Where the institution shares data under the Open Finance standards, a
> purified late-payment amount surfaces as `DonatedToCharity`. That field is the customer-visible end
> of this policy: it says the money left. It does not say the process above was followed, and it must
> never be populated from a figure that was booked as income under another name.

## 5. What this charter is not

- It is **not** an assertion that the institution is Shari'ah-compliant. It is an assertion about who
  audits, how independently, and against what.
- It is **not** enforceable by the harness. The gates read `docs/governance/issc-register.json` and
  the evidence records; the independence lives in the board's appointment and this document.
- It **does not** let any agent, gate or reviewer form a Shari'ah opinion. Where this charter says
  "approved", it means a named human in a named role approved it, and the record proves who.
