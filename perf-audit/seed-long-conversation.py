#!/usr/bin/env python3
"""Seed a long conversation into a throwaway OD instance through the PRODUCTION HTTP API.

Shapes come from the user's real DB (read-only); only the *scale* is synthetic
(the real 41-message conversation is replayed R times with fresh ids).
"""
import json, sqlite3, sys, urllib.request, uuid, time, os

BASE = os.environ.get('OD_BASE', 'http://127.0.0.1:17856')
SRC_DB = '/private/tmp/claude-501/-Users-elian-Documents-open-design/386d7caa-109b-426e-8132-d2b081aacac5/scratchpad/perf-db/app.sqlite'

def req(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, method=method,
                               headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(r, timeout=120) as resp:
        raw = resp.read()
        return json.loads(raw) if raw else None

def load_real(cid):
    con = sqlite3.connect('file:%s?mode=ro' % SRC_DB, uri=True)
    con.row_factory = sqlite3.Row
    rows = con.execute('select * from messages where conversation_id=? order by position', (cid,)).fetchall()
    con.close()
    out = []
    for r in rows:
        d = dict(r)
        m = {'id': d['id'], 'role': d['role'], 'content': d['content'],
             'createdAt': d['created_at']}
        for src, dst in [('agent_id','agentId'),('agent_name','agentName'),
                         ('run_id','runId'),('run_status','runStatus'),
                         ('result_delivery_state','resultDeliveryState'),
                         ('session_mode','sessionMode'),
                         ('started_at','startedAt'),('ended_at','endedAt')]:
            if d.get(src) is not None: m[dst] = d[src]
        for src, dst in [('events_json','events'),('attachments_json','attachments'),
                         ('produced_files_json','producedFiles'),
                         ('task_analytics_json','taskAnalytics'),
                         ('run_context_json','runContext')]:
            if d.get(src):
                try: m[dst] = json.loads(d[src])
                except Exception: pass
        out.append(m)
    return out

def main():
    src_cid = sys.argv[1] if len(sys.argv) > 1 else '7e97c7e9-4978-4b09-b2d0-f4842949cf89'
    repeats = int(sys.argv[2]) if len(sys.argv) > 2 else 1
    name = sys.argv[3] if len(sys.argv) > 3 else 'perf'
    tmpl = load_real(src_cid)
    pid_new = 'perf-%s-%s' % (name, uuid.uuid4().hex[:8])
    proj = req('POST', '/api/projects', {'id': pid_new, 'name': 'perf-%s' % name})
    pid = proj['project']['id'] if 'project' in proj else proj['id']
    conv = req('POST', '/api/projects/%s/conversations' % pid, {'id': 'conv-%s' % uuid.uuid4().hex[:10], 'title': 'perf-%s-%dx' % (name, repeats)})
    cid = conv['conversation']['id'] if 'conversation' in conv else conv['id']
    t0 = time.time()
    n = 0
    base_ts = int(time.time()*1000) - repeats*len(tmpl)*60000
    for rep in range(repeats):
        for i, m in enumerate(tmpl):
            mm = dict(m)
            mm['id'] = str(uuid.uuid4())
            mm['createdAt'] = base_ts + (n * 60000)
            if mm.get('startedAt'): mm['startedAt'] = mm['createdAt']
            if mm.get('endedAt'): mm['endedAt'] = mm['createdAt'] + 30000
            if mm.get('runId'): mm['runId'] = str(uuid.uuid4())
            req('PUT', '/api/projects/%s/conversations/%s/messages/%s' % (pid, cid, mm['id']), mm)
            n += 1
    print(json.dumps({'projectId': pid, 'conversationId': cid, 'messages': n,
                      'seconds': round(time.time()-t0, 1)}))

main()
