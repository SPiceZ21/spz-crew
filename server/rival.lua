-- server/rival.lua — Crew rivalries
-- Each crew is paired with another of similar average iRating, the same way
-- spz-progression pairs individual drivers. The pairing is stored in
-- crew_rivals and refreshed periodically; the dashboard reads a head-to-head
-- built from the crews' stored best laps (racelines) and career results.

local IDENT = "spz-identity"

local function profile(src)
    local ok, p = pcall(function() return exports[IDENT]:GetProfile(src) end)
    return ok and p or nil
end

-- Average iRating across a crew's members (0 when the crew is empty).
local function crewRating(crewId)
    return tonumber(MySQL.scalar.await(
        "SELECT AVG(NULLIF(i_rating, 0)) FROM players WHERE crew_id = ?", { crewId })) or 0
end

-- Closest crew by average rating that isn't this one.
local function pickRival(crewId)
    local mine = crewRating(crewId)
    return MySQL.scalar.await([[
        SELECT c.id
        FROM crews c
        JOIN players p ON p.crew_id = c.id
        WHERE c.id <> ?
        GROUP BY c.id
        HAVING COUNT(p.id) > 0
        ORDER BY ABS(COALESCE(AVG(NULLIF(p.i_rating, 0)), 0) - ?) ASC
        LIMIT 1
    ]], { crewId, mine })
end

local function getRival(crewId)
    return MySQL.scalar.await(
        "SELECT rival_crew_id FROM crew_rivals WHERE crew_id = ? LIMIT 1", { crewId })
end

local function assignRival(crewId)
    local rid = pickRival(crewId)
    if not rid then return nil end
    MySQL.query.await([[
        INSERT INTO crew_rivals (crew_id, rival_crew_id) VALUES (?, ?)
        ON DUPLICATE KEY UPDATE rival_crew_id = VALUES(rival_crew_id), assigned_at = NOW()
    ]], { crewId, rid })
    return rid
end

-- Career totals for one crew, summed over its current members.
local function crewStats(crewId)
    local row = MySQL.single.await([[
        SELECT COUNT(DISTINCT p.id)                                   AS members,
               COALESCE(AVG(NULLIF(p.i_rating, 0)), 0)                AS avg_irating,
               COALESCE(AVG(NULLIF(p.sr, 0)), 0)                      AS avg_sr,
               COALESCE(SUM(p.alltime_points), 0)                     AS points,
               COUNT(rr.id)                                           AS races,
               SUM(CASE WHEN rr.position = 1 THEN 1 ELSE 0 END)       AS wins,
               SUM(CASE WHEN rr.position <= 3 AND rr.dnf = 0 THEN 1 ELSE 0 END) AS podiums
        FROM players p
        LEFT JOIN race_results rr ON rr.player_id = p.id
        WHERE p.crew_id = ?
    ]], { crewId }) or {}

    local races = tonumber(row.races) or 0
    local wins  = tonumber(row.wins) or 0
    return {
        members     = tonumber(row.members) or 0,
        avg_irating = math.floor(tonumber(row.avg_irating) or 0),
        avg_sr      = tonumber(row.avg_sr) or 0,
        points      = tonumber(row.points) or 0,
        races       = races,
        wins        = wins,
        podiums     = tonumber(row.podiums) or 0,
        win_rate    = races > 0 and (wins / races) or 0,
    }
end

local function crewCard(crewId)
    local c = MySQL.single.await(
        "SELECT id, name, tag, image_url, description FROM crews WHERE id = ? LIMIT 1", { crewId })
    if not c then return nil end
    local stats = crewStats(crewId)
    return {
        id = c.id, name = c.name, tag = c.tag, image = c.image_url, description = c.description,
        members = stats.members, avg_irating = stats.avg_irating, avg_sr = stats.avg_sr,
        points = stats.points, races = stats.races, wins = stats.wins,
        podiums = stats.podiums, win_rate = stats.win_rate,
    }
end

-- Best stored lap per track for each crew, with the member who set it.
local function headToHead(mine, theirs)
    local rows = MySQL.query.await([[
        SELECT r.track,
               MIN(CASE WHEN p.crew_id = ? THEN r.best_ms END) AS my_ms,
               MIN(CASE WHEN p.crew_id = ? THEN r.best_ms END) AS rival_ms,
               (SELECT p2.username FROM racelines r2 JOIN players p2 ON p2.id = r2.player_id
                 WHERE r2.track = r.track AND p2.crew_id = ?
                 ORDER BY r2.best_ms ASC LIMIT 1) AS my_holder,
               (SELECT p3.username FROM racelines r3 JOIN players p3 ON p3.id = r3.player_id
                 WHERE r3.track = r.track AND p3.crew_id = ?
                 ORDER BY r3.best_ms ASC LIMIT 1) AS rival_holder
        FROM racelines r
        JOIN players p ON p.id = r.player_id
        WHERE p.crew_id IN (?, ?)
        GROUP BY r.track
        ORDER BY r.track ASC
    ]], { mine, theirs, mine, theirs, mine, theirs }) or {}

    local tracks, wins, losses = {}, 0, 0
    for _, r in ipairs(rows) do
        local a, b = tonumber(r.my_ms), tonumber(r.rival_ms)
        if a and b then
            if a < b then wins = wins + 1 else losses = losses + 1 end
        end
        tracks[#tracks + 1] = {
            track        = r.track,
            my_ms        = a,
            rival_ms     = b,
            my_holder    = r.my_holder,
            rival_holder = r.rival_holder,
            -- +ve margin = your crew is faster
            margin       = (a and b) and (b - a) or nil,
        }
    end
    return tracks, wins, losses
end

-- ── Callback ─────────────────────────────────────────────────────────────────

lib.callback.register("spz-crew:rival", function(source)
    local p = profile(source)
    if not p or not p.crew_id then return { rival = nil } end

    local rid = getRival(p.crew_id) or assignRival(p.crew_id)
    if not rid then return { rival = nil, me = crewCard(p.crew_id) } end

    local me    = crewCard(p.crew_id)
    local rival = crewCard(rid)
    if not rival then return { rival = nil, me = me } end

    local tracks, wins, losses = headToHead(p.crew_id, rid)
    return {
        me = me,
        rival = rival,
        head_to_head = { wins = wins, losses = losses, tracks = #tracks },
        tracks = tracks,
    }
end)

-- ── Periodic re-pairing ──────────────────────────────────────────────────────
-- Keeps each online player's crew matched against a crew of similar strength.

CreateThread(function()
    Wait(60000)   -- let the schema and identity settle first
    while true do
        local seen = {}
        for _, s in ipairs(GetPlayers()) do
            local pl = profile(tonumber(s))
            if pl and pl.crew_id and not seen[pl.crew_id] then
                seen[pl.crew_id] = true
                assignRival(pl.crew_id)
            end
        end
        Wait(30 * 60 * 1000)
    end
end)
