-- server/main.lua — Crew dashboard
-- Thin server layer over spz-identity's crew exports (CreateCrew/JoinCrew/
-- LeaveCrew handle cooldown + statebag sync). Adds the dashboard reads (my crew
-- + roster, browse list) and owner actions (kick, disband).

local IDENT = "spz-identity"

local function profile(src)
    local ok, p = pcall(function() return exports[IDENT]:GetProfile(src) end)
    return ok and p or nil
end

-- Seconds left on this player's crew-change cooldown (0 = ready).
local function cooldownRemaining(pid)
    local total = exports[IDENT]:GetCrewCooldownSeconds() or 0
    if total <= 0 then return 0 end
    local last = MySQL.scalar.await("SELECT last_crew_change FROM players WHERE id = ? LIMIT 1", { pid }) or 0
    local rem = total - (os.time() - last)
    return rem > 0 and rem or 0
end

-- ── Reads ─────────────────────────────────────────────────────────────────────

lib.callback.register("spz-crew:data", function(source)
    local p = profile(source)
    if not p then return { crew = nil } end

    local out = { cooldown = cooldownRemaining(p.id), myPid = p.id }

    if p.crew_id then
        local crew = exports[IDENT]:GetCrew(p.crew_id)
        if crew then
            out.crew = { id = crew.id, name = crew.name, tag = crew.tag, ownerId = crew.owner_id, isOwner = crew.owner_id == p.id }
            local rows = MySQL.query.await(
                "SELECT id, username, rank, i_rating FROM players WHERE crew_id = ? ORDER BY (id = ?) DESC, username ASC",
                { crew.id, crew.owner_id })
            local roster = {}
            for _, r in ipairs(rows or {}) do
                roster[#roster + 1] = {
                    pid = r.id, name = r.username or ("Driver " .. r.id),
                    rank = r.rank, irating = r.i_rating,
                    owner = r.id == crew.owner_id,
                }
            end
            out.roster = roster
        end
    end
    return out
end)

lib.callback.register("spz-crew:list", function()
    local rows = MySQL.query.await([[
        SELECT c.id, c.name, c.tag, c.owner_id, COUNT(p.id) AS members
        FROM crews c
        LEFT JOIN players p ON p.crew_id = c.id
        GROUP BY c.id
        ORDER BY members DESC, c.name ASC
        LIMIT 100
    ]])
    return rows or {}
end)

-- ── Mutations (reuse spz-identity, which syncs cooldown + statebags) ──────────

lib.callback.register("spz-crew:create", function(source, name, tag)
    if type(name) ~= "string" or type(tag) ~= "string" then return { ok = false, error = "Invalid input" } end
    name = name:gsub("^%s+", ""):gsub("%s+$", "")
    tag = tag:upper():gsub("%s+", "")
    if #name < 3 or #name > 24 then return { ok = false, error = "Name must be 3–24 chars" } end

    local crewId, err = exports[IDENT]:CreateCrew(source, name, tag)
    if not crewId then return { ok = false, error = err or "Failed" } end
    return { ok = true, crewId = crewId }
end)

lib.callback.register("spz-crew:join", function(source, crewId)
    local ok, err = exports[IDENT]:JoinCrew(source, tonumber(crewId))
    if not ok then
        if type(err) == "number" then return { ok = false, error = ("On cooldown: %ds"):format(err) } end
        return { ok = false, error = err or "Failed" }
    end
    return { ok = true }
end)

lib.callback.register("spz-crew:leave", function(source)
    local ok, err = exports[IDENT]:LeaveCrew(source)
    if not ok then
        if type(err) == "number" then return { ok = false, error = ("On cooldown: %ds"):format(err) } end
        return { ok = false, error = err or "Failed" }
    end
    return { ok = true }
end)

-- Owner kicks a member (by player_id). Works whether they're online or not.
lib.callback.register("spz-crew:kick", function(source, targetPid)
    targetPid = tonumber(targetPid)
    local p = profile(source)
    if not p or not p.crew_id then return { ok = false, error = "Not in a crew" } end

    local crew = exports[IDENT]:GetCrew(p.crew_id)
    if not crew or crew.owner_id ~= p.id then return { ok = false, error = "Only the owner can kick" } end
    if targetPid == p.id then return { ok = false, error = "Can't kick yourself" } end

    local inCrew = MySQL.scalar.await("SELECT id FROM players WHERE id = ? AND crew_id = ? LIMIT 1", { targetPid, crew.id })
    if not inCrew then return { ok = false, error = "Not a member" } end

    -- If online, go through UpdateProfile so their statebag/nametag clears.
    local tsrc = nil
    for _, s in ipairs(GetPlayers()) do
        local tp = profile(tonumber(s))
        if tp and tp.id == targetPid then tsrc = tonumber(s); break end
    end
    if tsrc then
        exports[IDENT]:UpdateProfile(tsrc, { crew_id = nil })
        TriggerEvent("SPZ:crewChanged", tsrc, crew.id, nil)
        TriggerClientEvent("spz-crew:notify", tsrc, "You were removed from the crew", "warning")
    else
        MySQL.update.await("UPDATE players SET crew_id = NULL WHERE id = ?", { targetPid })
    end
    return { ok = true }
end)

-- Owner disbands: clear every member, delete the crew.
lib.callback.register("spz-crew:disband", function(source)
    local p = profile(source)
    if not p or not p.crew_id then return { ok = false, error = "Not in a crew" } end
    local crew = exports[IDENT]:GetCrew(p.crew_id)
    if not crew or crew.owner_id ~= p.id then return { ok = false, error = "Only the owner can disband" } end

    local crewId = crew.id
    -- Clear online members' profiles/statebags first.
    for _, s in ipairs(GetPlayers()) do
        local tp = profile(tonumber(s))
        if tp and tp.crew_id == crewId then
            exports[IDENT]:UpdateProfile(tonumber(s), { crew_id = nil })
            TriggerEvent("SPZ:crewChanged", tonumber(s), crewId, nil)
            if tonumber(s) ~= source then
                TriggerClientEvent("spz-crew:notify", tonumber(s), "Your crew was disbanded", "warning")
            end
        end
    end
    MySQL.update.await("UPDATE players SET crew_id = NULL WHERE crew_id = ?", { crewId })
    MySQL.query.await("DELETE FROM crews WHERE id = ?", { crewId })
    return { ok = true }
end)
