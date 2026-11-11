// inbound-spine-ship — drain lp-k5c4 with file-disjoint waves and automerge.
//
// Waves: docs/plans/0019-inbound-work-spine/parallel-waves.md
// Launch:
//   /workflow inbound-spine-ship {"auto_merge":true,"concurrency":3,"max_waves":12}
// Watch: /workflows
// Budget: 256–1024 (slash default 128 is too small for a full drain).

let meta = #{
    name: "inbound-spine-ship",
    description: "Drain lp-k5c4 inbound spine: implement ready leaves, QA, CI, squash-merge",
    when_to_use: "Ship 0019 inbound work spine beads as fast as file-disjoint waves allow",
    phases: [
        #{ title: "Implement", detail: "parallel unblocked leaves" },
        #{ title: "Qa", detail: "web-ui-testing proof" },
        #{ title: "Fix", detail: "re-implement QA failures" },
        #{ title: "Ci", detail: "validate.sh and PR checks" },
        #{ title: "Merge", detail: "merge to main and close beads" },
        #{ title: "Report", detail: "wave summary" },
    ],
};

let select_schema = #{
    "type": "object",
    "required": ["beads", "epic_complete", "blocked_reason", "notes"],
    "properties": #{
        "epic_complete": #{ "type": "boolean" },
        "blocked_reason": #{ "type": "string" },
        "notes": #{ "type": "string" },
        "beads": #{
            "type": "array",
            "maxItems": 8,
            "items": #{
                "type": "object",
                "required": ["id", "title", "needs_human", "needs_ui_qa", "branch", "issue_type"],
                "properties": #{
                    "id": #{ "type": "string" },
                    "title": #{ "type": "string" },
                    "needs_human": #{ "type": "boolean" },
                    "needs_ui_qa": #{ "type": "boolean" },
                    "branch": #{ "type": "string" },
                    "issue_type": #{ "type": "string" },
                    "priority": #{ "type": "integer" },
                },
            },
        },
    },
};

let implement_schema = #{
    "type": "object",
    "required": ["bead_id", "success", "branch", "commit_sha", "needs_ui_qa", "summary", "acceptance_met"],
    "properties": #{
        "bead_id": #{ "type": "string" },
        "success": #{ "type": "boolean" },
        "branch": #{ "type": "string" },
        "commit_sha": #{ "type": "string" },
        "pr_url": #{ "type": "string" },
        "needs_ui_qa": #{ "type": "boolean" },
        "acceptance_met": #{ "type": "boolean" },
        "summary": #{ "type": "string" },
        "error": #{ "type": "string" },
        "files_touched": #{ "type": "array", "items": #{ "type": "string" } },
    },
};

let uiqa_schema = #{
    "type": "object",
    "required": ["bead_id", "passed", "skipped", "summary", "screenshot_paths"],
    "properties": #{
        "bead_id": #{ "type": "string" },
        "passed": #{ "type": "boolean" },
        "skipped": #{ "type": "boolean" },
        "summary": #{ "type": "string" },
        "screenshot_paths": #{ "type": "array", "maxItems": 20, "items": #{ "type": "string" } },
        "error": #{ "type": "string" },
    },
};

let ci_schema = #{
    "type": "object",
    "required": ["passed", "summary", "pr_urls"],
    "properties": #{
        "passed": #{ "type": "boolean" },
        "summary": #{ "type": "string" },
        "pr_urls": #{ "type": "array", "items": #{ "type": "string" } },
        "failed_commands": #{ "type": "array", "items": #{ "type": "string" } },
    },
};

let merge_schema = #{
    "type": "object",
    "required": ["closed", "merged", "failed", "skipped", "notes"],
    "properties": #{
        "notes": #{ "type": "string" },
        "closed": #{ "type": "array", "items": #{ "type": "string" } },
        "merged": #{ "type": "array", "items": #{ "type": "string" } },
        "failed": #{ "type": "array", "items": #{ "type": "string" } },
        "skipped": #{ "type": "array", "items": #{ "type": "string" } },
        "pr_urls": #{ "type": "array", "items": #{ "type": "string" } },
    },
};

let epic_id = "lp-k5c4";
let concurrency = 3;
let max_waves = 12;
let auto_merge = true;
let base_branch = "main";
let env_file = ".env.mocklab-agent-dev";
let repo_root = "/home/operator/Lanyard-Dev/lanyard-platform";
let only_ids = [];

if args != () {
    if args.epic_id != () && type_of(args.epic_id) == "string" {
        epic_id = args.epic_id;
    }
    if args.concurrency != () { concurrency = args.concurrency; }
    if args.max_waves != () { max_waves = args.max_waves; }
    if args.auto_merge != () { auto_merge = args.auto_merge; }
    if args.base_branch != () && type_of(args.base_branch) == "string" && args.base_branch != "" {
        base_branch = args.base_branch;
    }
    if args.env_file != () && type_of(args.env_file) == "string" && args.env_file != "" {
        env_file = args.env_file;
    }
    if args.repo_root != () && type_of(args.repo_root) == "string" && args.repo_root != "" {
        repo_root = args.repo_root;
    }
    if args.ids != () && type_of(args.ids) == "array" {
        only_ids = args.ids;
    }
}

if concurrency < 1 { concurrency = 1; }
if concurrency > 8 { concurrency = 8; }
if max_waves < 1 { max_waves = 1; }
if max_waves > 20 { max_waves = 20; }

let scope_label = if epic_id == "" { "all-ready" } else { epic_id };
log("beads-ship scope=" + scope_label
    + " concurrency=" + concurrency.to_string()
    + " max_waves=" + max_waves.to_string()
    + " auto_merge=" + auto_merge.to_string());

fn trimmed(s) {
    if type_of(s) != "string" { return ""; }
    s.trim();
    s
}

fn id_ok(bead_id, prefix, allowed) {
    if type_of(bead_id) != "string" { return false; }
    if allowed != () && type_of(allowed) == "array" && allowed.len() > 0 {
        let hit = false;
        for a in allowed {
            if a == bead_id { hit = true; }
        }
        if !hit { return false; }
    }
    if prefix == "" { return true; }
    if bead_id == prefix { return false; }
    let dotted = prefix + ".";
    if bead_id.len() < dotted.len() { return false; }
    bead_id.sub_string(0, dotted.len()) == dotted
}

fn is_skipped(bead_id) {
    if bead_id == "lp-k5c4.9" { return true; }
    if bead_id == "lp-k5c4.14" { return true; }
    if bead_id == "lp-k5c4.13" { return true; }
    false
}

fn filter_ready(raw_beads, prefix, cap, allowed) {
    let out = [];
    if raw_beads == () { return out; }
    if type_of(raw_beads) != "array" { return out; }
    for b in raw_beads {
        if b == () { continue; }
        if b.id == () { continue; }
        if b.issue_type == "epic" { continue; }
        if b.needs_human == true { continue; }
        if is_skipped(b.id) { continue; }
        if !id_ok(b.id, prefix, allowed) { continue; }
        if out.len() >= cap { break; }
        out.push(b);
    }
    out
}

fn wave_fingerprint(beads) {
    let s = "";
    for b in beads {
        if b != () && b.id != () {
            s += b.id;
            s += ",";
        }
    }
    fingerprint(s)
}

fn qa_passed(ui_results, bead_id, required) {
    if !required { return true; }
    for ur in ui_results {
        if ur == () { continue; }
        if !ur.success { continue; }
        if ur.output == () { continue; }
        if ur.output.bead_id != bead_id { continue; }
        if ur.output.skipped == true { return true; }
        if ur.output.passed == true { return true; }
        return false;
    }
    false
}

fn build_select_prompt(epic, cap, base, root, allowed) {
    let p = "";
    p += "You are the SELECT agent for beads-ship. Use the shell. Do not invent Beads state.\n";
    p += "cd ";
    p += root;
    p += " && export BEADS_DIR=";
    p += root;
    p += "/.beads\n";
    p += "Run: bd ready --json\n";
    p += "Run: bd list --status=in_progress --json\n";
    p += "bd show candidates as needed.\n\n";
    p += "Scope epic_id=";
    p += epic;
    p += " (empty means every ready leaf in this repo).\n";
    p += "If epic_id is set, keep ids that start with that epic plus a dot. Exclude the epic itself.\n";
    p += "Exclude issue_type epic. Exclude needs_human / bd human / type decision unless the user listed it in ids.\n";
    p += "If bd ready is empty but epic children are in_progress with an OPEN PR, RETURN those beads so this wave can CI/merge them. Do not set blocked_reason for merge-stage in_progress. blocked_reason is only for human/HOLD or a dep with no PR.\n";
    p += "Do not re-implement a bead that already has a PR unless CI failed on files that PR actually changed. Then still return it so implement/fix can run.\n";
    p += "Prefer higher priority (lower number), then older, then id.\n";
    p += "Cap ";
    p += cap.to_string();
    p += " beads. Prefer file/package-disjoint work. Serialize two beads that both edit package.json or CI workflows.\n";
    p += "lp-k5c4 file groups (never pick two from the same group in one wave):\n";
    p += "- shared types: lp-k5c4.2\n";
    p += "- queue+send: lp-k5c4.3\n";
    p += "- CP wake/stop: lp-k5c4.4 then lp-k5c4.5 (serialize)\n";
    p += "- BFF SSE/registry: lp-k5c4.12 then lp-k5c4.7 if they share app.ts; else one each\n";
    p += "- callers: lp-k5c4.6\n";
    p += "- gate: lp-k5c4.8\n";
    p += "Skip lp-k5c4.9 (Rust later), lp-k5c4.14 (EC2 residual), lp-k5c4.13 (column drop last).\n";
    p += "Wave C after .3 merges: prefer .4 (CP) + .12 (hub) + .7 (signal-activity/events) if files do not overlap.\n";
    p += "Read docs/plans/0019-inbound-work-spine/parallel-waves.md.\n";
    p += "allowed ids JSON (empty = no extra filter): ";
    p += json_encode(allowed);
    p += "\n";
    p += "branch = beads/<id>-<slug> (slug lowercase title, non-alnum to dash, max 40).\n";
    p += "needs_ui_qa=true unless the bead is docs-only, contracts-only, or a decision record with no Portal/UI/chat/tools surface.\n";
    p += "Chat, tools, vault, office, agents, workflows, subagents, settings, mocklab UI: needs_ui_qa=true.\n";
    p += "epic_complete=true only when no open non-epic children remain under the epic (or, if epic_id empty, bd ready is empty and no in_progress matches).\n";
    p += "If ready is empty AND in_progress children have open PRs, put those in beads[] and blocked_reason=\"\".\n";
    p += "If ready is empty AND the only remaining open children are skipped residuals (lp-k5c4.9/.14/.13), epic_complete=true, beads=[].\n";
    p += "base_branch=";
    p += base;
    p += "\nReturn only the schema object.\n";
    p
}

fn pstack_block() {
    let p = "";
    p += "PSTACK (required before you write code):\n";
    p += "Read /home/operator/.grok/skills/pstack-playbooks/SKILL.md.\n";
    p += "Match a playbook: feature.md for new behavior, bug-fix.md for defects.\n";
    p += "Read and apply, naming each in your summary:\n";
    p += "- principle-model-the-domain (types/state before branching)\n";
    p += "- principle-foundational-thinking (data structures first)\n";
    p += "- principle-laziness-protocol (smallest change; delete before add)\n";
    p += "- principle-redesign-from-first-principles (no bolt-on special cases)\n";
    p += "- principle-boundary-discipline (validate at edges)\n";
    p += "- principle-type-system-discipline\n";
    p += "- principle-separate-before-serializing-shared-state (parallel workers)\n";
    p += "- principle-build-the-lever (script/codemod over hand edits when repeating)\n";
    p += "- principle-prove-it-works (real artifact, not it-compiles)\n";
    p += "Do not duct-tape a one-off. If this is a tool, follow docs/architecture/short-stack-tool-placement.md.\n";
    p += "If the design has no precedent, sketch 2 shapes and pick one; note architect skipped: reason if you skip architect.\n\n";
    p
}

fn build_implement_prompt(bead, epic, base, env_path, root, qa_note) {
    let bid = bead.id;
    let title = if bead.title != () { bead.title } else { "" };
    let branch = if bead.branch != () { bead.branch } else { "beads/" + bid };
    let itype = if bead.issue_type != () { bead.issue_type } else { "task" };

    let p = "";
    p += "You are the IMPLEMENTER for one Beads issue. Isolated git worktree only.\n";
    p += "Bead: ";
    p += bid;
    p += "\nTitle: ";
    p += title;
    p += "\nBranch: ";
    p += branch;
    p += "\nType: ";
    p += itype;
    p += "\nEpic/scope: ";
    p += epic;
    p += "\nBase: ";
    p += base;
    p += "\nRepo: ";
    p += root;
    p += "\n";
    if qa_note != "" {
        p += "\nTHIS IS A FIX PASS. Previous UI QA failed:\n";
        p += qa_note;
        p += "\nFix the root cause. Do not paper over it.\n";
    }
    p += "\ncd ";
    p += root;
    p += " && export BEADS_DIR=";
    p += root;
    p += "/.beads\n";
    p += "Worktree (do not edit the main checkout):\n";
    p += "  WT=\"${TMPDIR:-/tmp}/lp-bead-";
    p += bid;
    p += "\"\n";
    p += "  git -C ";
    p += root;
    p += " fetch origin ";
    p += base;
    p += "\n";
    p += "  if git -C ";
    p += root;
    p += " worktree list | grep -q \"$WT\"; then cd \"$WT\"; git checkout ";
    p += branch;
    p += "; git pull --ff-only || true; else git -C ";
    p += root;
    p += " worktree add -B ";
    p += branch;
    p += " \"$WT\" origin/";
    p += base;
    p += "; cd \"$WT\"; fi\n";
    p += "  export BEADS_DIR=";
    p += root;
    p += "/.beads\n\n";
    p += pstack_block();
    p += "RULES:\n";
    p += "1. Only this bead. Do not start others. Do not merge to ";
    p += base;
    p += ".\n";
    p += "2. Never commit secrets or ";
    p += env_path;
    p += ".\n";
    p += "3. Follow AGENTS.md / CLAUDE.md.\n";
    p += "4. Acceptance criteria are done-when. Evidence in summary.\n";
    p += "5. Durable tests for new behavior. Public API over private mocks.\n";
    p += "6. Do not bd close. Do not merge to main. The merge stage does that after QA and CI.\n";
    p += "7. If gh pr list already has an open PR for this bead/branch: do not rewrite the feature. Record existing commit_sha and pr_url, success=true if local tests for touched packages pass. Only push new commits if those tests fail on files this PR changed.\n\n";
    p += "STEPS:\n";
    p += "A) bd update ";
    p += bid;
    p += " --claim\n";
    p += "B) bd show ";
    p += bid;
    p += " — read description, design, acceptance.\n";
    p += "C) Implement in \"$WT\" on ";
    p += branch;
    p += ".\n";
    p += "D) Run package tests / scripts/validate.sh pieces that cover the change.\n";
    p += "E) git add -A && git commit -m \"";
    p += bid;
    p += ": <imperative summary>\"\n";
    p += "F) git push -u origin ";
    p += branch;
    p += "\n";
    p += "G) gh pr create --draft --base ";
    p += base;
    p += " --head ";
    p += branch;
    p += " --title \"";
    p += bid;
    p += ": ";
    p += title;
    p += "\" with bead id, summary, acceptance, test plan. If PR exists, do not open a second.\n";
    p += "H) commit_sha = git rev-parse HEAD. Record pr_url.\n";
    p += "needs_ui_qa=true if Portal/UI/chat/tools/vault/office changed.\n";
    p += "success=true only if pushed and acceptance met.\n";
    p += "Return schema object only.\n";
    p
}

fn build_uiqa_prompt(bead_id, env_path, branch, root) {
    let p = "";
    p += "You are the UI QA agent for bead ";
    p += bead_id;
    p += " branch ";
    p += branch;
    p += ".\n";
    p += "Read /home/operator/.grok/skills/web-ui-testing/SKILL.md and follow it.\n";
    p += "cd ";
    p += root;
    p += " && export BEADS_DIR=";
    p += root;
    p += "/.beads\n";
    p += "bd show ";
    p += bead_id;
    p += " so you know what to prove.\n\n";
    p += "AUTH: source gitignored ";
    p += root;
    p += "/";
    p += env_path;
    p += " (MOCKLAB_BASE_URL, MOCKLAB_AGENT_EMAIL, MOCKLAB_AGENT_PASSWORD). Never print the password.\n";
    p += "Prefer local Portal from the feature worktree when mocklab cannot show this branch.\n";
    p += "Worktree: ${TMPDIR:-/tmp}/lp-bead-";
    p += bead_id;
    p += " if it exists.\n\n";
    p += "PROOF:\n";
    p += "- Headless Playwright Chromium. Selector map, not pixel clicks.\n";
    p += "- Exercise the feature the way a user would (click, type, navigate). A screenshot of a render is not enough.\n";
    p += "- Screenshots: artifacts/ui/";
    p += bead_id;
    p += "/<step>.png\n";
    p += "- Hunt regressions on shared routes.\n";
    p += "- Close browser + bash $HOME/.grok/skills/web-ui-testing/scripts/kill_browsers.sh\n";
    p += "passed=true only with interaction evidence. skipped=true only if the bead has no UI surface (docs/contracts).\n";
    p += "Do not fake pass. Return schema object only.\n";
    p
}

fn build_ci_prompt(impls, root, base) {
    let p = "";
    p += "You are the CI agent. Run real commands. Do not merge.\n";
    p += "cd ";
    p += root;
    p += " && export BEADS_DIR=";
    p += root;
    p += "/.beads\n";
    p += "Base: ";
    p += base;
    p += "\nImplementations JSON:\n";
    p += json_encode(impls);
    p += "\n\n";
    p += "For each successful bead with a branch/PR:\n";
    p += "1) gh pr checks <pr> or gh pr view --json statusCheckRollup,mergeable,url\n";
    p += "2) In that worktree (${TMPDIR:-/tmp}/lp-bead-<id>) or a fresh worktree of the branch: bash scripts/validate.sh\n";
    p += "3) Package tests for touched surfaces (portal vitest / pytest as applicable).\n";
    p += "passed=true if every bead's local validate.sh (and targeted package tests) exited 0.\n";
    p += "GitHub Actions: pending is OK. FAILURE that is only billing/spending-limit/payments (jobs never started, empty steps) is NOT a code failure — note it in summary and still set passed=true when local CI is green.\n";
    p += "FAILURE on jobs whose failing files are NOT in the PR diff, when the same jobs are also red on origin/main, is pre-existing: passed=true, note it. Only fail the wave when a new test in the PR's own files is red.\n";
    p += "List failed_commands only for real test failures. Return schema object only.\n";
    p
}

fn build_merge_prompt(epic, base, do_merge, impls, ui_results, ci_out, root) {
    let p = "";
    p += "You are the MERGE agent for beads-ship.\n";
    p += "cd ";
    p += root;
    p += " && export BEADS_DIR=";
    p += root;
    p += "/.beads\n";
    p += "Base: ";
    p += base;
    p += "\nauto_merge=";
    p += do_merge.to_string();
    p += "\nScope: ";
    p += epic;
    p += "\nImplementations: ";
    p += json_encode(impls);
    p += "\nUI QA: ";
    p += json_encode(ui_results);
    p += "\nCI: ";
    p += json_encode(ci_out);
    p += "\n\n";
    p += "RULES:\n";
    p += "- Never force-push ";
    p += base;
    p += ".\n";
    p += "- Merge only beads whose implement.success, UI QA passed or skipped, and CI.passed are true.\n";
    p += "- If auto_merge=false: mark draft PRs ready, do not merge, list them in skipped, leave beads open.\n";
    p += "- If auto_merge=true: gh pr ready, then gh pr merge --squash --delete-branch (or repo default).\n";
    p += "- After merge: bd close <id> --reason with PR URL and one-line evidence.\n";
    p += "- Do not close if merge failed.\n";
    p += "Return schema object only.\n";
    p
}

fn qa_note_for(ui_results, bead_id) {
    for ur in ui_results {
        if ur == () { continue; }
        if ur.output == () { continue; }
        if ur.output.bead_id != bead_id { continue; }
        let s = "";
        if ur.output.summary != () { s += ur.output.summary.to_string(); }
        if ur.output.error != () && ur.output.error != "" {
            s += " | ";
            s += ur.output.error.to_string();
        }
        return s;
    }
    "UI QA failed or missing"
}

let all_closed = [];
let all_merged = [];
let all_failed = [];
let wave_reports = [];
let prior_fp = "";
let stall_count = 0;
let wave_n = 0;

while wave_n < max_waves {
    let wave_label = (wave_n + 1).to_string();
    log("=== wave " + wave_label + " / " + max_waves.to_string() + " ===");

    phase("Implement");
    let sel_prompt = build_select_prompt(epic_id, concurrency, base_branch, repo_root, only_ids);
    let sel = agent(sel_prompt, #{
        label: "select-w" + wave_label,
        capability_mode: "execute",
        output_schema: select_schema,
    });

    if sel == () || !sel.success || sel.output == () {
        log("select failed on wave " + wave_label);
        all_failed.push("select-wave-" + wave_label);
        break;
    }

    let selected = filter_ready(sel.output.beads, epic_id, concurrency, only_ids);
    let epic_done = sel.output.epic_complete == true;
    let blocked = if sel.output.blocked_reason != () { trimmed(sel.output.blocked_reason) } else { "" };

    log("selected " + selected.len().to_string() + " beads; epic_complete=" + epic_done.to_string());

    if selected.len() == 0 {
        if blocked != "" {
            log("no ready leaves; blocked=" + blocked + " — retry next wave without pausing (in_progress PRs should have been returned as beads)");
            wave_n += 1;
            if stall_count >= 2 {
                log("still empty after retries; finishing this run so a new launch can pick up");
                break;
            }
            stall_count += 1;
            continue;
        }
        log("no ready leaves — finishing");
        break;
    }

    let fp = wave_fingerprint(selected);
    if fp == prior_fp && prior_fp != "" {
        stall_count += 1;
    } else {
        stall_count = 0;
    }
    prior_fp = fp;
    if stall_count >= 2 {
        log("same bead set two waves — continue to CI/merge instead of pausing");
        stall_count = 0;
    }

    let impl_jobs = [];
    for b in selected {
        let ip = build_implement_prompt(b, scope_label, base_branch, env_file, repo_root, "");
        impl_jobs.push(#{
            prompt: ip,
            label: "impl:" + b.id,
            capability_mode: "all",
            isolation_worktree: false,
            output_schema: implement_schema,
        });
    }
    let impl_results = parallel(impl_jobs);

    let ok_impls = [];
    let i = 0;
    for r in impl_results {
        if r != () && r.success && r.output != () && r.output.success == true {
            ok_impls.push(r.output);
        } else {
            let fail_id = "unknown";
            if i < selected.len() && selected[i] != () && selected[i].id != () {
                fail_id = selected[i].id;
            }
            if r != () && r.output != () && r.output.bead_id != () {
                fail_id = r.output.bead_id;
            }
            all_failed.push(fail_id);
            log("implement failed for " + fail_id.to_string());
        }
        i += 1;
    }

    if ok_impls.len() == 0 {
        log("all implementers failed on wave " + wave_label);
        wave_n += 1;
        continue;
    }

    phase("Qa");
    let ui_jobs = [];
    for out in ok_impls {
        let want = out.needs_ui_qa != false;
        if want {
            let up = build_uiqa_prompt(out.bead_id, env_file, out.branch, repo_root);
            ui_jobs.push(#{
                prompt: up,
                label: "uiqa:" + out.bead_id,
                capability_mode: "all",
                output_schema: uiqa_schema,
            });
        }
    }
    let ui_results = [];
    if ui_jobs.len() > 0 {
        ui_results = parallel(ui_jobs);
    }

    let qa_ok = [];
    let qa_bad = [];
    for out in ok_impls {
        let required = out.needs_ui_qa != false;
        if qa_passed(ui_results, out.bead_id, required) {
            qa_ok.push(out);
        } else {
            qa_bad.push(out);
            log("QA failed for " + out.bead_id);
        }
    }

    phase("Fix");
    if qa_bad.len() > 0 {
        let fix_jobs = [];
        for out in qa_bad {
            let fake = #{
                id: out.bead_id,
                title: out.bead_id,
                branch: out.branch,
                issue_type: "bug",
            };
            let note = qa_note_for(ui_results, out.bead_id);
            let fpmt = build_implement_prompt(fake, scope_label, base_branch, env_file, repo_root, note);
            fix_jobs.push(#{
                prompt: fpmt,
                label: "fix:" + out.bead_id,
                capability_mode: "all",
                isolation_worktree: false,
                output_schema: implement_schema,
            });
        }
        let fix_results = parallel(fix_jobs);
        let fixed_impls = [];
        for r in fix_results {
            if r != () && r.success && r.output != () && r.output.success == true {
                fixed_impls.push(r.output);
            }
        }
        let re_jobs = [];
        for out in fixed_impls {
            let up = build_uiqa_prompt(out.bead_id, env_file, out.branch, repo_root);
            re_jobs.push(#{
                prompt: up,
                label: "uiqa-re:" + out.bead_id,
                capability_mode: "all",
                output_schema: uiqa_schema,
            });
        }
        let re_ui = [];
        if re_jobs.len() > 0 {
            re_ui = parallel(re_jobs);
        }
        for ur in re_ui {
            if ur != () { ui_results.push(ur); }
        }
        for out in fixed_impls {
            if qa_passed(re_ui, out.bead_id, true) {
                qa_ok.push(out);
            } else {
                all_failed.push(out.bead_id);
                log("QA still failing after fix for " + out.bead_id);
            }
        }
        for out in qa_bad {
            let recovered = false;
            for ok in qa_ok {
                if ok.bead_id == out.bead_id { recovered = true; }
            }
            if !recovered {
                let already = false;
                for f in all_failed {
                    if f == out.bead_id { already = true; }
                }
                if !already { all_failed.push(out.bead_id); }
            }
        }
    }

    if qa_ok.len() == 0 {
        log("nothing passed QA on wave " + wave_label);
        wave_n += 1;
        continue;
    }

    phase("Ci");
    let ci_prompt = build_ci_prompt(qa_ok, repo_root, base_branch);
    let ci = agent(ci_prompt, #{
        label: "ci-w" + wave_label,
        capability_mode: "execute",
        output_schema: ci_schema,
    });
    let ci_out = #{ passed: false, summary: "ci agent failed", pr_urls: [] };
    if ci != () && ci.success && ci.output != () {
        ci_out = ci.output;
    }
    if ci_out.passed != true {
        let ci_msg = if ci_out.summary != () { ci_out.summary } else { "CI failed" };
        log("CI failed on wave " + wave_label + ": " + ci_msg);
        for out in qa_ok { all_failed.push(out.bead_id); }
        wave_n += 1;
        continue;
    }

    phase("Merge");
    if !auto_merge {
        await_user("user", "CI passed for wave " + wave_label + " on " + scope_label
            + ". Resume to merge PRs to " + base_branch + ", or stop the run.");
    }
    let merge_prompt = build_merge_prompt(scope_label, base_branch, auto_merge, qa_ok, ui_results, ci_out, repo_root);
    let ship = agent(merge_prompt, #{
        label: "merge-w" + wave_label,
        capability_mode: "all",
        output_schema: merge_schema,
    });
    if ship != () && ship.success && ship.output != () {
        if ship.output.closed != () {
            for id in ship.output.closed { all_closed.push(id); }
        }
        if ship.output.merged != () {
            for id in ship.output.merged { all_merged.push(id); }
        }
        if ship.output.failed != () {
            for id in ship.output.failed { all_failed.push(id); }
        }
        wave_reports.push(#{
            wave: wave_n + 1,
            closed: ship.output.closed,
            merged: ship.output.merged,
            failed: ship.output.failed,
            notes: ship.output.notes,
        });
    } else {
        all_failed.push("merge-wave-" + wave_label);
        log("merge agent failed on wave " + wave_label + " — next wave will retry in_progress PRs");
    }

    let b = budget();
    if b != () && b.remaining != () && b.remaining < 10 {
        await_user("back_off", "Agent budget low (remaining=" + b.remaining.to_string()
            + "). Resume with a higher agent_budget, or stop.");
    }

    if epic_done {
        log("select marked epic complete after this wave");
    }
    wave_n += 1;
}

phase("Report");
let report = "";
report += "# beads-ship result\n\n";
report += "- scope: ";
report += scope_label;
report += "\n- waves_run: ";
report += wave_n.to_string();
report += "\n- auto_merge: ";
report += auto_merge.to_string();
report += "\n- closed: ";
report += json_encode(all_closed);
report += "\n- merged: ";
report += json_encode(all_merged);
report += "\n- failed: ";
report += json_encode(all_failed);
report += "\n- wave_reports: ";
report += json_encode(wave_reports);
report += "\n";

let report_path = write_scratch_file("beads-ship-report.md", report);
log("wrote " + report_path);

complete(#{
    summary: "beads-ship finished for " + scope_label,
    epic_id: epic_id,
    waves_run: wave_n,
    closed: all_closed,
    merged: all_merged,
    failed: all_failed,
    wave_reports: wave_reports,
    path: report_path,
});
