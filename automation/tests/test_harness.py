"""Harness self-tests (stdlib unittest). Run: python3 -m unittest discover -s automation/tests -v

Scope note: these test the HARNESS TOOLS. The local HTTP servers below are stubs used only to
exercise the capability detector's status logic; they say nothing about real n8n behavior.
"""
import copy
import http.server
import json
import os
import shutil
import sys
import tempfile
import threading
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "automation" / "tools"))

import capabilities  # noqa: E402
import common  # noqa: E402
import state  # noqa: E402
import testlog  # noqa: E402
import validate_workflow as vw  # noqa: E402

SAMPLE = REPO / "invoice-follow-up-automation" / "workflow.json"


class Sandbox(unittest.TestCase):
    """Temp harness home + temp repo root so tests never touch real state."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.saved = {k: os.environ.get(k) for k in ("AUTOMATION_HOME", "AUTOMATION_REPO_ROOT", "HOME",
                                                    "N8N_API_URL", "N8N_BASE_URL", "N8N_API_KEY")}
        (self.tmp / "automation").mkdir()
        shutil.copytree(REPO / "automation" / "templates", self.tmp / "automation" / "templates")
        os.environ.update(AUTOMATION_HOME=str(self.tmp / "automation"), AUTOMATION_REPO_ROOT=str(self.tmp),
                          HOME=str(self.tmp))
        for k in ("N8N_API_URL", "N8N_BASE_URL", "N8N_API_KEY"):
            os.environ.pop(k, None)
        self.addCleanup(self._restore)

    def _restore(self):
        for k, v in self.saved.items():
            os.environ.pop(k, None)
            if v is not None:
                os.environ[k] = v

    # helpers
    def new_automation(self, with_workflow=True, wf=None):
        state.save(state.fresh())
        s = state.init("Invoice Test")
        if with_workflow:
            p = self.tmp / s["workflow_path"]
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(json.dumps(wf if wf is not None else json.loads(SAMPLE.read_text())))
        return s

    def tool_check(self):
        common.write_json(common.home() / "reports" / "environment.json", capabilities.detect([]))

    def to(self, target, **kw):
        return state.transition(target, "test", **kw)

    def log(self, tid, status, scope="STATIC", **kw):
        d = dict(test_id=tid, description=tid, status=status, scope=scope, actual="a", evidence="e")
        d.update(kw)
        return testlog.add(testlog.default_path(), d)

    def advance_to_inspected(self):
        for st in ("DISCOVERY_COMPLETE", "PLAN_READY", "SCOPE_FROZEN", "DESIGN_READY"):
            self.to(st)
        self.tool_check()
        for st in ("BUILDING", "BUILT", "INSPECTED"):
            self.to(st)


class TestStateMachine(Sandbox):
    def test_initial_state_is_new_and_safe(self):
        s = state.fresh()
        self.assertEqual(s["state"], "NEW")
        self.assertEqual(s["safety"], {"workflow_active": False, "external_side_effects_enabled": False,
                                       "credentials_modified": False, "production_activation_authorized": False})
        self.assertEqual(set(state.STATES), set(state.TRANSITIONS) | {"BLOCKED"})

    def test_init_copies_templates_with_name(self):
        s = self.new_automation()
        self.assertIn("Invoice Test", (self.tmp / s["artifact_dir"] / "scope.md").read_text())

    def test_happy_path_to_activated_requires_each_gate(self):
        self.new_automation()
        self.advance_to_inspected()
        self.to("TESTING")
        self.log("S1", "PASS")
        self.log("T1-runtime", "BLOCKED", scope="RUNTIME", evidence="no n8n runtime", actual="")
        self.to("VERIFIED")
        v = state.load()["verification"]
        self.assertEqual((v["level"], v["unverified_count"]), ("STATIC_ONLY", 1))
        with self.assertRaisesRegex(state.StateError, "accept-unverified"):
            self.to("READY_FOR_APPROVAL")
        self.to("READY_FOR_APPROVAL", accept_unverified="user accepted draft-only review")
        with self.assertRaisesRegex(state.StateError, "APPROVED needs"):
            self.to("APPROVED")
        with self.assertRaises(state.StateError):
            self.to("ACTIVATED", evidence="x")        # illegal: skips APPROVED
        self.to("APPROVED", by="human", statement="approved")
        self.assertTrue(state.load()["safety"]["production_activation_authorized"])
        with self.assertRaisesRegex(state.StateError, "evidence"):
            self.to("ACTIVATED")
        self.to("ACTIVATED", evidence="activated by human in n8n UI")
        # change control: reopening wipes approval and restores safe defaults
        self.to("DESIGN_READY")
        s = state.load()
        self.assertIsNone(s["approval"])
        self.assertFalse(s["safety"]["production_activation_authorized"])

    def test_illegal_transitions_and_gates(self):
        self.new_automation()
        with self.assertRaisesRegex(state.StateError, "illegal"):
            self.to("TESTING")
        for st in ("DISCOVERY_COMPLETE", "PLAN_READY", "SCOPE_FROZEN", "DESIGN_READY"):
            self.to(st)
        with self.assertRaisesRegex(state.StateError, "TOOL CHECK"):
            self.to("BUILDING")
        self.tool_check()
        self.to("BUILDING")
        self.to("BUILT")

    def test_built_requires_workflow_file(self):
        self.new_automation(with_workflow=False)
        for st in ("DISCOVERY_COMPLETE", "PLAN_READY", "SCOPE_FROZEN", "DESIGN_READY"):
            self.to(st)
        self.tool_check()
        self.to("BUILDING")
        with self.assertRaisesRegex(state.StateError, "not found"):
            self.to("BUILT")

    def test_inspection_errors_block_progress(self):
        bad = json.loads(SAMPLE.read_text())
        bad["nodes"] = [n for n in bad["nodes"] if "Trigger" not in n["type"] and "schedule" not in n["type"].lower()]
        self.new_automation(wf=bad)
        for st in ("DISCOVERY_COMPLETE", "PLAN_READY", "SCOPE_FROZEN", "DESIGN_READY"):
            self.to(st)
        self.tool_check()
        self.to("BUILDING")
        self.to("BUILT")
        with self.assertRaisesRegex(state.StateError, "static inspection found"):
            self.to("INSPECTED")
        self.assertEqual(state.load()["state"], "BUILT")
        self.to("FAILED")

    def test_verified_refused_with_failures_or_no_pass(self):
        self.new_automation()
        self.advance_to_inspected()
        self.to("TESTING")
        with self.assertRaisesRegex(state.StateError, "VERIFIED needs"):
            self.to("VERIFIED")
        self.log("T1", "FAIL", actual="boom")
        with self.assertRaisesRegex(state.StateError, "VERIFIED needs"):
            self.to("VERIFIED")

    def test_repair_loop_is_bounded_then_blocks(self):
        self.new_automation()
        self.advance_to_inspected()
        self.to("TESTING")
        self.log("T1", "FAIL", actual="boom")
        self.to("FAILED")
        with self.assertRaisesRegex(state.StateError, "failure-class"):
            self.to("DIAGNOSED")
        for cycle in range(1, 4):
            self.to("DIAGNOSED", failure_class="B", root_cause=f"cause {cycle}")
            self.to("REPAIRING")
            self.assertEqual(state.load()["repair_iterations"], cycle)
            self.to("INSPECTED")
            self.assertTrue(state.load()["retest_pending"])
            with self.assertRaisesRegex(state.StateError, "RETESTING"):
                self.to("TESTING")
            self.to("RETESTING")
            self.to("FAILED")
        self.to("DIAGNOSED", failure_class="B", root_cause="cause 4")
        with self.assertRaisesRegex(state.StateError, "HUMAN_INVESTIGATION_REQUIRED"):
            self.to("REPAIRING")
        s = state.load()
        self.assertEqual(s["state"], "BLOCKED")
        self.assertIn("HUMAN_INVESTIGATION_REQUIRED", s["blocked"]["reason"])
        self.assertEqual(s["repair_iterations"], 3)
        with self.assertRaises(state.StateError):
            self.to("REPAIRING")                      # BLOCKED has no outgoing transitions
        state.unblock("DIAGNOSED", "human", "investigated")
        self.assertEqual(state.load()["repair_iterations"], 0)
        with self.assertRaises(state.StateError):
            state.unblock("ACTIVATED", "human", "nope")

    def test_repair_then_retest_reaches_verified(self):
        self.new_automation()
        self.advance_to_inspected()
        self.to("TESTING")
        self.log("T1", "FAIL", actual="boom")
        self.to("FAILED")
        self.to("DIAGNOSED", failure_class="G", root_cause="wrong expected value")
        self.to("REPAIRING")
        self.to("INSPECTED")
        self.to("RETESTING")
        self.log("T1", "PASS", actual="fixed")
        self.assertEqual(testlog.load(testlog.default_path())["tests"][0]["attempt"], 2)
        self.to("VERIFIED")
        self.assertFalse(state.load()["retest_pending"])

    def test_active_workflow_blocks_approval_path(self):
        wf = json.loads(SAMPLE.read_text())
        self.new_automation(wf=wf)
        self.advance_to_inspected()
        self.to("TESTING")
        self.log("S1", "PASS")
        self.to("VERIFIED")
        wf["active"] = True                           # someone flips it to active after verification
        (self.tmp / state.load()["workflow_path"]).write_text(json.dumps(wf))
        with self.assertRaisesRegex(state.StateError, "re-validation"):
            self.to("READY_FOR_APPROVAL", accept_unverified="x")

    def test_next_action_defined_for_every_state(self):
        for st in state.STATES:
            s = state.fresh()
            s["state"] = st
            self.assertEqual(state.next_action(s)["state"], st)


class TestTestLog(Sandbox):
    def setUp(self):
        super().setUp()
        self.new_automation()

    def test_pass_requires_evidence(self):
        with self.assertRaises(testlog.TestLogError):
            self.log("T", "PASS", evidence="")
        with self.assertRaises(testlog.TestLogError):
            self.log("T", "PASS", actual="")

    def test_runtime_pass_requires_execution_reference(self):
        with self.assertRaisesRegex(testlog.TestLogError, "execution_reference"):
            self.log("T", "PASS", scope="RUNTIME")
        self.log("T", "PASS", scope="RUNTIME", execution_reference="exec-123")

    def test_blocked_needs_reason_and_never_counts_as_pass(self):
        with self.assertRaises(testlog.TestLogError):
            self.log("T", "BLOCKED", evidence="")
        self.log("T", "BLOCKED", evidence="no runtime", actual="")
        self.log("U", "NOT_TESTED", evidence="not attempted", actual="")
        summ = testlog.summarize(testlog.default_path())
        self.assertEqual(summ["counts"], {"PASS": 0, "FAIL": 0, "BLOCKED": 1, "NOT_TESTED": 1})
        self.assertEqual(summ["verification"], "NONE")

    def test_bad_status_and_scope_rejected(self):
        with self.assertRaises(testlog.TestLogError):
            self.log("T", "OK")
        with self.assertRaises(testlog.TestLogError):
            self.log("T", "PASS", scope="MAGIC")

    def test_verification_levels(self):
        self.log("A", "PASS")
        self.assertEqual(testlog.summarize(testlog.default_path())["verification"], "STATIC_ONLY")
        self.log("B", "PASS", scope="RUNTIME", execution_reference="e1")
        self.assertEqual(testlog.summarize(testlog.default_path())["verification"], "RUNTIME_VERIFIED")
        self.log("C", "BLOCKED", evidence="x", actual="")
        self.assertEqual(testlog.summarize(testlog.default_path())["verification"], "PARTIAL")

    def test_record_fields(self):
        r = self.log("A", "PASS", input="i", expected="x")
        for k in ("test_id", "description", "input", "expected", "actual", "status", "evidence", "execution_reference"):
            self.assertIn(k, r)
        self.assertEqual(r["execution_reference"], "NONE")


class _Stub(http.server.BaseHTTPRequestHandler):
    api_status = 200

    def do_GET(self):
        code = 200 if self.path.startswith("/healthz") else type(self).api_status
        self.send_response(code)
        self.end_headers()
        self.wfile.write(b"{}")

    def log_message(self, *a):
        pass


class TestCapabilities(Sandbox):
    VALID = {"AVAILABLE", "AVAILABLE_BUT_UNUSABLE", "UNAVAILABLE", "NOT_CONFIGURED", "NOT_TESTED"}

    def serve(self, api_status):
        handler = type("H", (_Stub,), {"api_status": api_status})
        srv = http.server.HTTPServer(("127.0.0.1", 0), handler)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        self.addCleanup(srv.server_close)
        self.addCleanup(srv.shutdown)
        return f"http://127.0.0.1:{srv.server_address[1]}"

    def test_real_environment_report_is_well_formed(self):
        rep = capabilities.detect(["Bash", "mcp__github__get_me"])
        self.assertIn(rep["capability_level"], (0, 1, 2, 3))
        for k, v in rep["statuses"].items():
            self.assertIn(v["status"], self.VALID, k)
        for k in ("claude_code_tools", "mcp_integrations", "n8n_mcp_configured", "n8n_mcp_tools", "n8n_reachable",
                  "n8n_api", "docker_cli", "docker_daemon", "node", "npx", "git", "workflow_artifact"):
            self.assertIn(k, rep["statuses"])
        self.assertEqual(rep["statuses"]["mcp_integrations"]["servers"], ["github"])

    def test_unobserved_tools_are_not_tested_not_guessed(self):
        rep = capabilities.detect(None)
        self.assertEqual(rep["statuses"]["n8n_mcp_tools"]["status"], "NOT_TESTED")
        self.assertEqual(rep["statuses"]["claude_code_tools"]["status"], "NOT_TESTED")

    def test_unconfigured_n8n_is_level_0(self):
        rep = capabilities.detect([])
        s = rep["statuses"]
        self.assertEqual((s["n8n_api"]["status"], s["n8n_mcp_configured"]["status"], s["n8n_mcp_tools"]["status"]),
                         ("NOT_CONFIGURED", "NOT_CONFIGURED", "UNAVAILABLE"))
        self.assertEqual(rep["capability_level"], 0)
        self.assertFalse(rep["runtime_tests_possible"])

    def test_configured_mcp_without_callable_tools_is_unusable(self):
        (self.tmp / ".mcp.json").write_text(json.dumps({"mcpServers": {"n8n-mcp": {"command": "x"}}}))
        rep = capabilities.detect(["Bash"], root=self.tmp)
        self.assertEqual(rep["statuses"]["n8n_mcp_configured"]["status"], "AVAILABLE")
        self.assertEqual(rep["statuses"]["n8n_mcp_tools"]["status"], "AVAILABLE_BUT_UNUSABLE")
        self.assertEqual(rep["capability_level"], 0)

    def test_observed_n8n_tools_give_level_3(self):
        rep = capabilities.detect(["Bash", "mcp__n8n-mcp__n8n_list_workflows"], root=self.tmp)
        self.assertEqual(rep["statuses"]["n8n_mcp_tools"]["status"], "AVAILABLE")
        self.assertEqual(rep["capability_level"], 3)

    def test_level_1_when_workflow_artifact_exists(self):
        wf = self.tmp / "w.json"
        wf.write_text("{}")
        self.assertEqual(capabilities.detect([], workflow=str(wf), root=self.tmp)["capability_level"], 1)

    def test_api_statuses_against_local_stub(self):
        os.environ["N8N_API_KEY"] = "dummy-test-key"
        os.environ["N8N_API_URL"] = self.serve(200)
        rep = capabilities.detect([])
        self.assertEqual(rep["statuses"]["n8n_api"]["status"], "AVAILABLE")
        self.assertEqual(rep["capability_level"], 2)
        self.assertNotIn("dummy-test-key", json.dumps(rep))
        os.environ["N8N_API_URL"] = self.serve(401)
        rep = capabilities.detect([])
        self.assertEqual(rep["statuses"]["n8n_api"]["status"], "AVAILABLE_BUT_UNUSABLE")
        self.assertEqual(rep["capability_level"], 0)
        os.environ["N8N_API_URL"] = "http://127.0.0.1:9"      # closed port
        rep = capabilities.detect([])
        self.assertEqual(rep["statuses"]["n8n_reachable"]["status"], "UNAVAILABLE")
        self.assertEqual(rep["statuses"]["n8n_api"]["status"], "UNAVAILABLE")


class TestValidator(unittest.TestCase):
    def wf(self):
        return json.loads(SAMPLE.read_text())

    def codes(self, wf, sev=None):
        return {f["code"] for f in vw.validate(wf)["findings"] if sev is None or f["severity"] == sev}

    def test_existing_workflows_have_no_static_errors(self):
        for f in sorted(REPO.glob("*/workflow.json")):
            rep = vw.validate_file(f)
            self.assertEqual(rep["error_count"], 0, (f, rep["findings"]))
            self.assertEqual(rep["verification"], "STATICALLY_VERIFIED")
            self.assertEqual(rep["runtime"], "RUNTIME_NOT_TESTED")

    def test_invalid_json_and_missing_file(self):
        p = Path(tempfile.mkdtemp()) / "x.json"
        p.write_text("{nope")
        self.assertEqual(vw.validate_file(p)["verification"], "UNREADABLE")
        self.assertEqual(vw.validate_file(p.with_name("none.json"))["verification"], "UNREADABLE")

    def test_missing_trigger(self):
        w = self.wf()
        w["nodes"] = [n for n in w["nodes"] if n["name"] != "Daily Check"]
        w["connections"].pop("Daily Check", None)
        self.assertIn("NO_TRIGGER", self.codes(w, "ERROR"))

    def test_disconnected_and_unreachable_nodes(self):
        w = self.wf()
        w["nodes"].append({"name": "Orphan", "type": "n8n-nodes-base.set", "typeVersion": 3, "position": [0, 0], "parameters": {}})
        w["nodes"].append({"name": "Island B", "type": "n8n-nodes-base.set", "typeVersion": 3, "position": [0, 0], "parameters": {}})
        w["connections"]["Orphan"] = {"main": [[{"node": "Island B", "type": "main", "index": 0}]]}
        found = {(f["code"], f["node"]) for f in vw.validate(w)["findings"]}
        self.assertIn(("UNREACHABLE_NODE", "Orphan"), found)
        self.assertIn(("UNREACHABLE_NODE", "Island B"), found)
        w["nodes"].append({"name": "Alone", "type": "n8n-nodes-base.set", "typeVersion": 3, "position": [0, 0], "parameters": {}})
        self.assertIn(("DISCONNECTED_NODE", "Alone"), {(f["code"], f["node"]) for f in vw.validate(w)["findings"]})

    def test_bad_connections(self):
        w = self.wf()
        w["connections"]["Ghost"] = {"main": [[{"node": "Daily Check", "type": "main", "index": 0}]]}
        w["connections"]["Daily Check"]["main"][0].append({"node": "Nowhere", "type": "main", "index": 0})
        codes = self.codes(w, "ERROR")
        self.assertIn("CONNECTION_FROM_UNKNOWN_NODE", codes)
        self.assertIn("CONNECTION_TO_UNKNOWN_NODE", codes)

    def test_duplicate_names(self):
        w = self.wf()
        w["nodes"].append(copy.deepcopy(w["nodes"][0]))
        self.assertIn("DUPLICATE_NODE_NAME", self.codes(w, "ERROR"))

    def test_expression_checks(self):
        w = self.wf()
        w["nodes"][1]["parameters"]["x"] = "={{ $('No Such Node').item.json.a }}"
        w["nodes"][1]["parameters"]["y"] = "={{ $json.a "
        w["nodes"][1]["parameters"]["z"] = "hello {{ $json.a }}"
        w["nodes"][1]["parameters"]["jsCode"] = "return $('Also Missing').all();"
        errs = [f["message"] for f in vw.validate(w)["findings"] if f["severity"] == "ERROR"]
        self.assertTrue(any("No Such Node" in m for m in errs))
        self.assertTrue(any("Also Missing" in m for m in errs))
        self.assertIn("UNBALANCED_EXPRESSION", self.codes(w, "ERROR"))
        self.assertIn("EXPRESSION_WITHOUT_EQUALS", self.codes(w, "WARN"))

    def test_secrets_detected_and_redacted(self):
        w = self.wf()
        w["nodes"][1]["parameters"]["headers"] = {"Authorization": "Bearer abcdefghijklmnopqrstuvwxyz123456"}
        w["nodes"][1]["parameters"]["apiKey"] = "literalsecretvalue99"
        w["nodes"][1]["credentials"] = {"gmailOAuth2": {"id": "1", "name": "n", "accessToken": "zzzzzzzzzz"}}
        rep = vw.validate(w)
        codes = {f["code"] for f in rep["findings"]}
        self.assertTrue({"HARDCODED_SECRET", "SUSPECT_SECRET_FIELD", "CREDENTIAL_INLINE_VALUES"} <= codes)
        blob = json.dumps(rep)
        self.assertNotIn("abcdefghijklmnopqrstuvwxyz123456", blob)
        self.assertNotIn("literalsecretvalue99", blob)

    def test_active_workflow_is_an_error(self):
        w = self.wf()
        w["active"] = True
        self.assertIn("ACTIVE_WORKFLOW", self.codes(w, "ERROR"))

    def test_dead_branch_and_side_effects_reported(self):
        w = {"name": "t", "active": False, "nodes": [
            {"name": "T", "type": "n8n-nodes-base.webhook", "typeVersion": 2, "position": [0, 0], "parameters": {}},
            {"name": "If", "type": "n8n-nodes-base.if", "typeVersion": 2, "position": [1, 0], "parameters": {}},
            {"name": "Mail", "type": "n8n-nodes-base.gmail", "typeVersion": 2, "position": [2, 0],
             "parameters": {"operation": "send"}, "credentials": {"gmailOAuth2": {"id": "1", "name": "g"}}}],
            "connections": {"T": {"main": [[{"node": "If", "type": "main", "index": 0}]]},
                            "If": {"main": [[{"node": "Mail", "type": "main", "index": 0}]]}}}
        rep = vw.validate(w)
        self.assertEqual(rep["error_count"], 0)
        self.assertIn("DEAD_BRANCH", {f["code"] for f in rep["findings"]})
        self.assertEqual([s["node"] for s in rep["side_effect_nodes"]], ["Mail"])

    def test_ai_subnode_attached_to_parent_is_reachable(self):
        w = {"nodes": [
            {"name": "T", "type": "n8n-nodes-base.webhook", "typeVersion": 2, "position": [0, 0], "parameters": {}},
            {"name": "Agent", "type": "@n8n/n8n-nodes-langchain.agent", "typeVersion": 1, "position": [1, 0], "parameters": {}},
            {"name": "LLM", "type": "@n8n/n8n-nodes-langchain.lmChatGoogleGemini", "typeVersion": 1, "position": [1, 1],
             "parameters": {}, "credentials": {"googlePalmApi": {"id": "1", "name": "g"}}}],
            "connections": {"T": {"main": [[{"node": "Agent", "type": "main", "index": 0}]]},
                            "LLM": {"ai_languageModel": [[{"node": "Agent", "type": "ai_languageModel", "index": 0}]]}}}
        self.assertNotIn("UNREACHABLE_NODE", self.codes(w))
        self.assertNotIn("DISCONNECTED_NODE", self.codes(w))


if __name__ == "__main__":
    unittest.main()
