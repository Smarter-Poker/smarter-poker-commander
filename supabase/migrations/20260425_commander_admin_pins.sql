-- Phase 3.6 — Commander admin PIN gate (server-side)
--
-- Replaces the legacy client-side PIN check. PINs are stored as a
-- salted SHA-256 hash (salt = user_id, computed in the app before
-- being sent to the RPC). Lockout after 5 fails for 15 min.

CREATE TABLE IF NOT EXISTS commander_admin_pins (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  pin_hash TEXT NOT NULL,
  fail_count INT NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE commander_admin_pins ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users see own pin" ON commander_admin_pins
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- INSERT/UPDATE only via SECURITY DEFINER RPCs below. Direct writes blocked.

-- Set PIN (upsert)
CREATE OR REPLACE FUNCTION set_commander_admin_pin(p_pin_hash TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_pin_hash IS NULL OR length(p_pin_hash) <> 64 THEN
    RAISE EXCEPTION 'Invalid PIN hash';
  END IF;
  INSERT INTO commander_admin_pins (user_id, pin_hash)
  VALUES (auth.uid(), p_pin_hash)
  ON CONFLICT (user_id) DO UPDATE
    SET pin_hash = EXCLUDED.pin_hash,
        fail_count = 0,
        locked_until = NULL,
        updated_at = now();
END;
$$;

-- Verify PIN with lockout
CREATE OR REPLACE FUNCTION verify_commander_admin_pin(p_pin_hash TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_stored_hash TEXT;
  v_fail_count INT;
  v_locked_until TIMESTAMPTZ;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT pin_hash, fail_count, locked_until
  INTO v_stored_hash, v_fail_count, v_locked_until
  FROM commander_admin_pins
  WHERE user_id = auth.uid();

  -- No PIN set
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  -- Locked out
  IF v_locked_until IS NOT NULL AND v_locked_until > now() THEN
    RETURN FALSE;
  END IF;

  -- Match → reset fail counter
  IF v_stored_hash = p_pin_hash THEN
    UPDATE commander_admin_pins
       SET fail_count = 0,
           locked_until = NULL,
           updated_at = now()
     WHERE user_id = auth.uid();
    RETURN TRUE;
  END IF;

  -- Mismatch → bump counter, lock at 5
  UPDATE commander_admin_pins
     SET fail_count = v_fail_count + 1,
         locked_until = CASE WHEN v_fail_count + 1 >= 5
                             THEN now() + INTERVAL '15 minutes'
                             ELSE NULL END,
         updated_at = now()
   WHERE user_id = auth.uid();
  RETURN FALSE;
END;
$$;

REVOKE ALL ON FUNCTION set_commander_admin_pin(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION verify_commander_admin_pin(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_commander_admin_pin(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION verify_commander_admin_pin(TEXT) TO authenticated;

COMMENT ON TABLE commander_admin_pins IS 'Phase 3.6 — server-side PIN storage for commander admin gate.';
COMMENT ON FUNCTION set_commander_admin_pin IS 'Upsert PIN for current auth.uid(). Resets lockout state.';
COMMENT ON FUNCTION verify_commander_admin_pin IS 'Verify PIN for current auth.uid() with 5-fail lockout (15 min cooldown).';
