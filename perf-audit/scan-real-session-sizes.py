import sqlite3, sys
rows=[]
for f in open('/private/tmp/claude-501/-Users-elian-Documents-open-design/386d7caa-109b-426e-8132-d2b081aacac5/scratchpad/perf-dbs.txt').read().split():
    try:
        con=sqlite3.connect('file:%s?mode=ro'%f, uri=True)
        for cid,n,eb,cb in con.execute("select conversation_id, count(*), sum(coalesce(length(events_json),0)), sum(length(content)) from messages group by 1"):
            rows.append((n, eb or 0, cb or 0, f, cid))
        con.close()
    except Exception as e:
        print("ERR", f, e, file=sys.stderr)
rows.sort(reverse=True)
print("total conversations scanned:", len(rows))
ns=sorted(r[0] for r in rows)
import statistics
print("msgs per conversation: p50=%d p90=%d p99=%d max=%d"%(ns[len(ns)//2], ns[int(len(ns)*.9)], ns[int(len(ns)*.99)], ns[-1]))
print("TOP BY MESSAGE COUNT")
for r in rows[:12]:
    print("  msgs=%4d events=%9.1fKB content=%7.1fKB  %s %s"%(r[0], r[1]/1024, r[2]/1024, r[3].replace('/Users/elian/Documents/',''), r[4][:10]))
rows.sort(key=lambda r:-r[1])
print("TOP BY EVENTS BYTES")
for r in rows[:8]:
    print("  msgs=%4d events=%9.1fKB  %s %s"%(r[0], r[1]/1024, r[3].replace('/Users/elian/Documents/',''), r[4][:10]))
print("conversations with >=80 msgs (virtualization threshold):", sum(1 for r in rows if r[0]>80))
