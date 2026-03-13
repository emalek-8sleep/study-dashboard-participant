# Dashboard Analysis Guide

This guide walks through the data analysis features of the Study Dashboard. These features live in the **Admin Panel** under the analysis sub-tabs and allow you to generate statistical analysis plans, run analyses in-browser, and review historical results — all powered by AI and connected to your Google Sheet.

---

## Prerequisites

Before using the analysis features, make sure:

1. **Your Google Sheet has these tabs** (create them manually or let the Apps Script auto-create on first write):

   | Tab Name | Purpose |
   |----------|---------|
   | `Analysis Plans` | Stores saved analysis plans |
   | `Analysis History` | Stores completed analysis runs |

2. **Column headers for Analysis Plans** (row 1): `ID`, `Created At`, `Study`, `Title`, `IV`, `DV`, `Design`, `Conditions`, `Primary Outcome`, `Secondary Outcomes`, `Statistical Tests`, `Assumption Tests`, `Notes`, `Status`, `Source`, `Full Text`

3. **Column headers for Analysis History** (row 1): `ID`, `Plan ID`, `Created At`, `Study`, `Plan Title`, `Code Used`, `Results JSON`, `Interpretation`, `Report HTML`, `Status`

4. **Environment variables** are set in Vercel:
   - `ANTHROPIC_API_KEY` — needed for AI plan generation, code generation, and interpretation
   - `SHEET_WRITE_URL` — your Apps Script web app URL (for saving plans and runs)

5. **Apps Script** is deployed with `append_row` support for `Analysis Plans` and `Analysis History` tabs (see `AppsScript-Fixed.gs`)

---

## Accessing the Analysis Features

1. Log into the Admin Panel at `/admin`
2. Select your study from the study switcher (if multiple studies configured)
3. You'll see sub-tabs at the top: **Charts**, **Plan Generator**, **Run Analysis**, **History**

---

## Tab 1: Plan Generator

The Plan Generator helps you create a rigorous statistical analysis plan using Claude AI (Haiku model for cost efficiency).

### Step-by-step

**Step 1 — Variables & Design**
- **Study Design**: Select your design type (e.g., within-subjects, between-subjects, mixed)
- **Independent Variable(s)**: What you're manipulating (e.g., "Sleep condition: Baseline vs. Testing")
- **Dependent Variable(s)**: What you're measuring (e.g., "AHI_3_overall, Sleep_Efficiency")
- **Conditions/Groups**: List your conditions (e.g., "Baseline, Testing")

**Step 2 — Outcomes & Hypotheses**
- **Primary Outcome**: The main variable of interest
- **Secondary Outcomes**: Additional variables to analyze
- **Covariates**: Any control variables (optional)
- **Hypothesis**: Your expected result (e.g., "AHI will decrease from Baseline to Testing")

**Step 3 — Descriptive Review**
- The dashboard automatically calculates descriptive statistics (mean, SD, median, range) for each numeric column in your Daily Status data
- Review these to confirm your data looks reasonable before generating a plan
- Outliers are flagged at 2σ, 2.5σ, and 3σ thresholds

**Step 4 — Generated Plan**
- Click **Generate Plan** to send your inputs to Claude Haiku
- The AI returns a structured plan with:
  - **Recommended Tests** — specific statistical tests with rationale (e.g., paired t-test, Wilcoxon signed-rank)
  - **Assumption Tests** — what to check before running each test (e.g., Shapiro-Wilk for normality)
  - **Multiple Comparisons** — whether correction is needed (Bonferroni, FDR, etc.)
  - **Effect Sizes** — which metrics to report (Cohen's d, r, etc.)
  - **Power Considerations** — notes on statistical power given your sample size
  - **Interpretation Notes** — caveats and guidance
  - **Full Analysis Plan** — a complete markdown write-up

**Saving the Plan**
- Click **Save Plan** to write the plan to your `Analysis Plans` sheet tab
- Saved plans appear in the Run Analysis tab for execution

### Reference DAPs

You can upload reference Data Analysis Plans (DAPs) from previous studies to help Claude match your team's style and format. These are stored in your browser's localStorage (max 5 files, 8000 chars each) and sent as style context when generating plans.

---

## Tab 2: Run Analysis

The Run Analysis tab executes your saved analysis plans against your actual study data using Python (via Pyodide, a Python-in-the-browser runtime).

### Step-by-step

**Phase 1 — Select Plan**
- Choose a saved analysis plan from the list
- Each plan card shows the title, design, IV, DVs, and creation date

**Phase 2 — Review Data**
- See descriptive statistics for each DV broken down by condition
- An interactive scatter chart shows all data points with SD band overlays
- **Outlier management**: Click individual data points to exclude/restore them from the analysis
- Toggle between 2σ, 2.5σ, and 3σ outlier thresholds
- Excluded points are tracked and will be removed from the dataset before analysis
- Click **Generate Code →** when ready

**Phase 3 — Review Code**
- Claude Haiku generates Python code based on your plan, data columns, and conditions
- The code is fully editable — review it, tweak parameters, or rewrite sections
- The code uses the `RESULTS_JSON` protocol: it must print `RESULTS_JSON:` followed by a JSON string containing `tests`, `assumptions`, and `descriptives` arrays
- Click **Run Analysis** to execute

**Phase 4 — Running**
- Pyodide loads in the browser (first run takes ~30-40 seconds to download the Python runtime and install numpy, pandas, scipy, statsmodels)
- Subsequent runs in the same session are much faster (runtime is cached)
- You'll see progress messages as packages install and code executes

**Phase 5 — Results**
- **Test Results**: Each statistical test with test statistic, p-value, effect size, and interpretation
- **Assumption Checks**: Normality tests, homogeneity of variance, etc.
- **Descriptive Statistics**: Summary tables from the analysis
- **AI Interpretation**: Claude Sonnet generates a narrative interpretation covering:
  - Summary of Findings
  - Statistical Results
  - Assumption Checks
  - Limitations
  - Clinical Significance
- **Download Report**: Generates a standalone HTML report with all results, interpretation, and metadata

**Saving the Run**
- Click **Save Run** to write results to the `Analysis History` sheet tab
- The run stores: plan reference, Python code used, raw results JSON, interpretation text, report HTML, and status

---

## Tab 3: History

The History tab has three sub-tabs for reviewing past work.

### Runs

- Lists all completed analysis runs for the current study
- Click a run to expand its details: code, results, interpretation, and report
- **Stakeholder Q&A**: An embedded chat where you can ask Claude Sonnet questions about a specific run's results (e.g., "Is the effect size clinically meaningful?" or "What would happen if we excluded participant SBJ-003?"). Maintains multi-turn conversation context (up to 10 turns).

### Plans

- Lists all saved analysis plans
- Click to expand and see the full plan markdown, recommended tests, and assumption tests

### Reference DAPs

- Upload and manage reference Data Analysis Plans
- These are stored in localStorage and used as style context when generating new plans
- Max 5 files, 8000 characters each
- Useful for maintaining consistency across analyses within your team

---

## How Data Flows

```
Google Sheet (Daily Status tab)
    ↓ fetched via published CSV endpoint
Admin Dashboard (browser)
    ↓ user fills out plan form
Claude Haiku API → generates analysis plan JSON
    ↓ user saves plan
Apps Script → appends row to Analysis Plans tab
    ↓ user selects plan in Run Analysis
Claude Haiku API → generates Python code
    ↓ user reviews/edits code
Pyodide (browser) → executes Python, returns RESULTS_JSON
    ↓ results displayed
Claude Sonnet API → generates narrative interpretation
    ↓ user saves run
Apps Script → appends row to Analysis History tab
```

---

## Tips

- **Plan before you run** — the plan generator helps you think through your analysis strategy before writing any code. This avoids p-hacking and ensures your approach is defensible.
- **Always check assumptions** — the generated code includes assumption tests (normality, homogeneity). If assumptions are violated, the code typically includes non-parametric alternatives.
- **Edit the generated code** — AI-generated code is a starting point. Review it carefully, especially column name mappings and test parameters.
- **Use the Q&A chat** — after a run, the Stakeholder Q&A is great for exploring "what if" questions without re-running the whole analysis.
- **First Pyodide load is slow** — the Python runtime download is ~30-40s on first use. After that, it's cached in your browser session. Refreshing the page clears the cache.
- **Large datasets** — Pyodide runs in the browser and has memory limits. If you have >10,000 rows, consider filtering to the relevant subset before running.
- **Report downloads** — the HTML report is self-contained and can be shared via email or saved locally. It includes all results, interpretation, and metadata.

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Error generating plan: Unterminated string in JSON" | The AI response was too long and got truncated. Try again — the system auto-recovers partial responses. If persistent, simplify your plan inputs. |
| Plan saves but doesn't appear in sheet | Check that `SHEET_WRITE_URL` points to the correct Apps Script deployment and that the `Analysis Plans` tab exists with correct headers. |
| Pyodide fails to load | Check your internet connection. Pyodide downloads ~30MB of packages from a CDN. Some corporate firewalls block jsdelivr.net. |
| "Cannot read properties of undefined" | Usually a data format mismatch. Check that your Daily Status tab has the expected column names and that conditions are populated. |
| Save run fails | Ensure the `Analysis History` tab exists with correct headers and that your Apps Script has `'Analysis History'` in the `ALLOWED_TABS` array. |

---

## Google Sheet Tab Summary

| Tab | Created by | Used by |
|-----|-----------|---------|
| `Daily Status` | Coordinator (manual or backend) | Charts, Plan Generator, Run Analysis |
| `Study Config` | Coordinator | All pages (study name, config values) |
| `Analysis Plans` | Dashboard (via Save Plan) | Run Analysis (plan selection), History |
| `Analysis History` | Dashboard (via Save Run) | History (run review, Q&A) |
| `Comments` | Dashboard (participant comments) | Admin review |

---

*For setup and deployment, see `SETUP.md`. For planned improvements, see `IMPLEMENTATION-PLAN.md`.*
