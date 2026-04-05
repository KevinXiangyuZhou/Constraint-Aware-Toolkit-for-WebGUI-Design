# UIST Full Paper Plan: Constraint-Aware Toolkit for WebGUI Design

## Context

The MPCC-based cursor simulation model is **already published** (CHI EA '26). That paper covers model formulation, tunnel steering validation, cascading menu and lasso use cases. The UIST paper contributes the **interactive toolkit** — a Chrome extension that lets designers specify constrained cursor tasks on live websites, simulate diverse user behaviors via personas, and identify accessibility/usability issues without recruiting real end-users. The model is a cited black-box backend.

**Timeline**: 4 weeks to final submission.

---

## Paper Framing & Contributions

UIST values novel interactive systems. The paper argues:

1. **Unsolved interaction design problem**: No existing tool lets designers specify geometric cursor constraints directly on live, arbitrary websites and simulate how diverse user populations would navigate them.

2. **Novel interaction techniques**: Direct-manipulation constraint specification (keyboard-driven modes for waypoints, corridors, keep-in/keep-out zones overlaid on real web content). The constraint-to-simulation pipeline (visual design → geometric extraction → MPCC input → trajectory replay on live page).

3. **Persona-based predictive evaluation**: Designers compare how different user populations (motor-impaired, novice, expert) navigate their interfaces without recruiting those populations.

4. **Evaluation**: Expert reviews + case studies demonstrating the toolkit finds path-sensitive accessibility issues invisible to existing tools.

### Differentiating from the CHI EA Paper

| CHI EA '26 (Published) | UIST Submission (New) |
|---|---|
| The MPCC simulation model | The interactive design toolkit |
| Abstract tasks (tunnels, grids) | Real websites in the wild |
| Model validation (trajectory fidelity) | Toolkit evaluation (designer productivity) |
| Single user parameterization | Persona library for diverse user simulation |
| Programmatic/scripted tasks | Direct-manipulation constraint specification |
| No interactive tool | Full Chrome extension with design + experiment + replay |

### Paper Structure

| Section | Content | Pages |
|---|---|---|
| Introduction | Problem: designers lack tools for evaluating path-sensitive interactions for diverse users | 1 |
| Related Work | Cursor simulation (cite CHI EA), accessibility eval tools, design probes, persona-based eval | 1.5 |
| System Design | Interaction techniques, constraint specification, persona system, experiment framework | 3 |
| Implementation | Chrome extension architecture, backend integration, constraint-to-MPCC pipeline | 1 |
| Evaluation | Expert review + case studies + comparative analysis | 3 |
| Discussion + Conclusion | Limitations, future work | 1 |

---

## Implementation Priorities (Week 1)

### P0: Must-have for paper and evaluation

1. **Data export** — CSV/JSON export of experiment results (currently in-memory only)
   - Files: `sidepanel/experiment.js`, `sidepanel/playback.js`

2. **Interaction logging** — Timestamped log of all designer actions (task time, learning curve)
   - Files: `sidepanel/init.js`, `content/events.js`

3. **Results summary view** — Aggregated comparison table: persona × task metrics (MT, violation rate, click success)
   - Files: `sidepanel/playback.js`

### P1: Strongly recommended

4. **Multi-trajectory overlay** — Show simulated trajectories from multiple personas overlaid on the page simultaneously in different colors. Key figure for the paper.
   - Files: `content/overlay.js`, `content/replay.js`

5. **DOM-aware constraint generation** — Auto-generate keep-in corridors from menu/nav DOM elements by selecting them, instead of manual drawing. Strong interaction technique contribution.
   - Files: `content/design.js`, `content/events.js`

---

## Evaluation Plan (IRB-Resilient)

### IRB Strategy: Parallel Tracks

**Track A (preferred)**: File for IRB **exempt determination** on Day 1. Category 1 or 3 exemption for minimal-risk usability testing. Typical turnaround: 3-5 business days. If approved, run full within-subjects user study.

**Track B (backup)**: Frame as **expert review** — consulting domain experts on a tool, not studying human subjects. Many universities do not require IRB for this. Study protocol stays nearly identical; only framing and consent language changes.

**Track C (fallback)**: No formal study at all. Restructure evaluation as 3 detailed case studies + technical benchmarks + comparative analysis against existing tools. This is viable if the system contribution is strong enough.

Prepare all tracks in parallel during Week 1. Use whichever clears first.

---

### Evaluation Component 1: Expert Review (N=8-12)

**Works under both Track A and Track B.**

#### Framing
- Track A: "Within-subjects user study with N=12 participants"
- Track B: "Expert review with 8-12 UX practitioners evaluating the toolkit's utility for accessibility assessment"

#### Participants
- 8-12 people with UX design, web development, or accessibility evaluation experience
- Recruit from HCI lab, design courses, professional contacts
- For Track B: frame as "domain experts consulted for feedback" not "human subjects"

#### Research Questions
- RQ1: Does the toolkit help identify more path-sensitive accessibility issues compared to manual inspection?
- RQ2: Does persona-based simulation increase confidence in accessibility assessments?
- RQ3: What is the learning curve and perceived usability?

#### Conditions (Within-Subjects)
- **Baseline**: Browser DevTools + WCAG quick-reference checklist
- **Toolkit**: The Constraint-Aware Toolkit (with 15-min training)

#### Tasks (2 per condition, counterbalanced)

Each task is an accessibility audit of a specific interaction on a real website:

1. **Cascading menu evaluation**: Assess whether a dropdown/mega-menu is navigable by motor-impaired users. Identify problematic menu paths and explain why.

2. **Navigation flow evaluation**: Assess whether a multi-step navigation flow (sidebar → content → action) is accessible across user types. Identify bottleneck areas.

4 websites total (2 matched pairs of similar complexity, different sites, assigned to different conditions).

#### Measures

| Measure | How | Analysis |
|---|---|---|
| Issues found (count) | Expert-coded rubric with ground-truth list | Wilcoxon signed-rank |
| Issue quality (severity accuracy) | Match against expert panel | Wilcoxon signed-rank |
| Task time | Logged timestamps | Paired t-test |
| Confidence | 7-pt Likert per task | Wilcoxon signed-rank |
| SUS | 10-item (toolkit condition only) | Descriptive |
| NASA-TLX | Both conditions | Paired t-test |
| Qualitative | Semi-structured interview | Thematic analysis |

#### Procedure (~75 min per participant)

| Step | Duration | Details |
|---|---|---|
| Consent + demographics | 5 min | Background, experience with accessibility evaluation |
| Toolkit training | 15 min | Guided walkthrough: waypoints, constraints, simulation, results |
| Practice task | 5 min | Short practice on a simple website |
| Condition 1: 2 tasks | 20 min | Website Set A |
| Break | 5 min | |
| Condition 2: 2 tasks | 20 min | Website Set B (matched difficulty) |
| Questionnaires | 5 min | SUS, NASA-TLX, Likert items |
| Interview | 10 min | Perceived value, workflow fit, pain points |

Counterbalancing: Latin square for method order × website set assignment.

#### Ground Truth Preparation
- 2-3 HCI experts independently audit all 4 study websites beforehand
- Create master issue list with severity ratings (critical / major / minor)
- Target inter-rater agreement: Cohen's κ > 0.7

---

### Evaluation Component 2: Case Studies (Author-Conducted, No IRB)

**Works under all tracks. This runs regardless of IRB outcome.**

#### Case Study 1: Comparing Menu Designs for Accessibility
- Select 2-3 real cascading menu implementations with different widths/angles
- Define matching tasks with corridor constraints using the toolkit
- Run all 6 personas × 20 seeds per design
- **Key figures**: Trajectory overlays showing where impaired personas fail; violation rate bar chart by persona × design
- **Key finding**: Quantitatively identify which design is most accessible per user group

#### Case Study 2: Responsive Design Breakpoints
- Test same navigation task at 3+ viewport widths (375px, 768px, 1024px, 1920px)
- Run all personas at each width
- **Key figure**: Violation rate × viewport width curve, per persona
- **Key finding**: Identify the viewport breakpoint where motor-impaired users start failing, connecting to WCAG 2.5.8

#### Case Study 3: Comparing Toolkit vs. Static Analysis Tools
- Run Lighthouse, axe-core, and WAVE on the same websites used in the case studies
- Document which issues each tool catches
- Show that **path-sensitive issues** (menu corridors too narrow for impaired users, navigation paths requiring precise cursor control) are invisible to all existing static tools
- **Key table**: Issue type × tool detection matrix showing the toolkit's unique coverage

---

### Evaluation Component 3: Technical Benchmarks (Author-Conducted, No IRB)

**Works under all tracks.**

- **Scalability**: Measure constraint specification time and simulation time across 5+ real websites of varying complexity
- **Constraint coverage**: Demonstrate all constraint types (rect keep-in, rect keep-out, corridor keep-in, corridor keep-out) on real websites with real UI patterns
- **Persona sensitivity**: Show statistically significant differences between personas across case study tasks (ANOVA on MT, violation rate, path efficiency)
- **Reproducibility**: Demonstrate deterministic seeding produces identical trajectories across runs

---

## 4-Week Timeline

### Week 1: Implementation + Study Prep

- [ ] Implement data export (CSV/JSON)
- [ ] Implement interaction logging
- [ ] Implement multi-trajectory overlay visualization
- [ ] Improve results summary view
- [ ] File IRB exempt determination (Day 1)
- [ ] Simultaneously prepare Track B consent language (expert review framing)
- [ ] Select 4 study websites, begin expert audits for ground truth
- [ ] Write study protocol and training materials
- [ ] Begin writing: Introduction, Related Work

### Week 2: Case Studies + Begin Expert Review

- [ ] Run Case Studies 1, 2, 3 (author-conducted — no IRB dependency)
- [ ] Run technical benchmarks
- [ ] If IRB clears: pilot with 2 participants, iterate, begin main sessions
- [ ] If IRB not cleared: switch to Track B (expert review), begin sessions
- [ ] Write: System Design, Implementation sections
- [ ] Create system figures and screenshots

### Week 3: Complete Expert Review + Analyze

- [ ] Complete remaining sessions (target 8-12 total)
- [ ] Quantitative analysis (paired comparisons on all measures)
- [ ] Thematic analysis of interview transcripts
- [ ] Write: Evaluation section
- [ ] Create all result figures (trajectory overlays, bar charts, comparison tables)

### Week 4: Write + Polish

- [ ] Complete full draft
- [ ] Internal review with co-author
- [ ] Revise based on feedback
- [ ] Prepare supplementary materials (video figure, appendices)
- [ ] Final submission

---

## Key Risks and Mitigations

| Risk | Mitigation |
|---|---|
| IRB takes > 1 week | Track B (expert review) requires no IRB at most institutions; prepare in parallel |
| IRB fully blocked | Track C: 3 case studies + technical benchmarks + comparative analysis. Weaker but publishable if system contribution is strong |
| Not enough participants | Target 12, minimum viable is 8; recruit aggressively from HCI lab + design courses |
| Baseline too weak | Give participants a WCAG quick-reference card + brief DevTools orientation |
| Toolkit bugs during sessions | Extensive testing Week 1; have fallback for known issues |
| "Just a wrapper" critique | Emphasize interaction design contributions (constraint specification on live websites, DOM-aware generation, persona-based comparative evaluation); cite model as black box |

---

## Verification Plan

- **Before sessions**: Run full workflow end-to-end (design task → simulate 3 personas → export CSV → verify output) on each study website
- **During sessions**: Check interaction logs are recording after first 2 sessions
- **After sessions**: Verify ground-truth inter-rater reliability (κ > 0.7) before analyzing participant data
- **Case studies**: Verify all 6 personas produce statistically distinguishable results (one-way ANOVA, p < 0.05)
