# User Study Summary: Toolkit vs. LLM for Path-Sensitive Accessibility Evaluation

## Research Question

Does simulation-based evaluation produce more accurate accessibility assessments of path-sensitive interactions (cascading menus) compared to LLM-based visual reasoning?

## Design

- **Within-subjects**, N=8-12 (HCI/design students)
- **2 conditions**, counterbalanced: Toolkit vs. LLM
- **1 cascading menu task per condition** (2 matched websites)

## Conditions

**Toolkit**: Participant defines waypoints + corridor constraints on a live cascading menu → runs simulation with multiple personas (motor-impaired, office worker, etc.) → views trajectory visualization + metrics → writes evaluation report + design recommendations.

**LLM (baseline)**: Participant uses a standardized vision LLM (provided by us) → uploads screenshots/recordings of the menu → asks LLM to evaluate accessibility for motor-impaired users → iterates with follow-ups → writes evaluation report + design recommendations.

## Task

> "Evaluate this cascading menu's accessibility for motor-impaired users. The user needs to navigate from [top-level] to [3rd-level item]. Report issues, severity, and design recommendations."

Two matched websites (e.g., e-commerce mega-menu, institutional dropdown). Ground truth pre-computed by running all 6 personas × 50 seeds.

## What Participants Produce

A structured evaluation form per task:
- Issue list (location, description, affected user groups, severity, evidence)
- Design recommendations (specific fixes for each issue)
- Confidence score (7-pt Likert)

## Key Measures

| Measure | Description |
|---|---|
| Issue count | How many ground-truth issues found |
| Specificity | Exact menu level/transition identified |
| Severity accuracy | Match vs. ground truth |
| Recommendation quality | Specific ("widen to 40px") vs. vague ("make bigger") |
| Evidence quality | Quantitative (simulation data) vs. qualitative (visual guess) |
| Confidence, SUS, NASA-TLX | Standard questionnaires |

## Procedure (~75 min)

1. Consent + demographics (5 min)
2. Training on both tools (15 min)
3. Practice task (5 min)
4. Condition 1 — 1 task (20 min)
5. Break (5 min)
6. Condition 2 — 1 task (20 min)
7. Questionnaires + interview (15 min)

## Expected Outcome

The toolkit condition reveals path-specific issues (corridor width, turn angles, speed-accuracy tradeoffs) that the LLM misses. Toolkit participants produce more specific, quantitatively-grounded recommendations. LLMs reason well about visible properties but cannot simulate motor control.

## Additional Evaluation (Author-Conducted)

- **Case Study 1**: Compare 2-3 menu designs across 6 personas
- **Case Study 2**: Toolkit vs. Lighthouse/axe-core/WAVE — show path-sensitive issues are invisible to static tools
- **Technical benchmarks**: Persona sensitivity, reproducibility, scalability
