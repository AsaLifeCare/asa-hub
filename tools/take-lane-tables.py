"""HISTORY. On 2026-10-27 at 19:00Z this tool copied, once, the 19 tables the lanes read from the old platform's
database into asa-hub-db's own tables (db/lane_tables.sql), each proved by its row count and an order-free digest of
every row: 19 of 19 equal. The old platform is shut down, so there is nothing left to copy; the tool's code as it ran is
in the commit that brought it in (asa_dev f8c694df). It does nothing now.
"""
import sys

if __name__ == "__main__":
    print("historical: the lane tables were copied and proved on 2026-10-27; nothing to do")
    sys.exit(0)
