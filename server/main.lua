-- server/main.lua — Crew dashboard
-- Thin server layer over spz-identity's crew exports (CreateCrew/JoinCrew/
-- LeaveCrew handle cooldown + statebag sync). Adds the dashboard reads (my crew
-- + roster, browse list) and owner actions (kick, disband).

local IDENT = "spz-identity"

local function profile(src)
    local ok, p = pcall(function() return exports[IDENT]:GetProfile(src) end)
    return ok and p or nil
end

-- Defined further down, in the invites section; forward-declared so the data
-- callback above can read them.
local incomingInvites, outgoingInvites

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
    out.invites = incomingInvites(p.id)

    if p.crew_id then
        local crew = exports[IDENT]:GetCrew(p.crew_id)
        if crew then
            out.crew = {
                id = crew.id, name = crew.name, tag = crew.tag,
                image = crew.image_url,
                description = crew.description,
                colour = crew.colour,
                recruiting = (crew.recruiting == nil) or crew.recruiting == 1,
                created_at = crew.created_at,
                ownerId = crew.owner_id, isOwner = crew.owner_id == p.id,
            }
            -- Roster with the numbers the dashboard shows per member. Race
            -- counts come from race_results so the roster can rank by activity.
            local rows = MySQL.query.await([[
                SELECT p.id, p.username, p.avatar_url, p.rank, p.level,
                       p.i_rating, p.sr, p.alltime_points,
                       COUNT(rr.id) AS races,
                       SUM(CASE WHEN rr.position = 1 THEN 1 ELSE 0 END) AS wins
                FROM players p
                LEFT JOIN race_results rr ON rr.player_id = p.id
                WHERE p.crew_id = ?
                GROUP BY p.id
                ORDER BY (p.id = ?) DESC, p.alltime_points DESC, p.username ASC
            ]], { crew.id, crew.owner_id })

            local roster = {}
            for _, r in ipairs(rows or {}) do
                roster[#roster + 1] = {
                    pid     = r.id,
                    name    = r.username or ("Driver " .. r.id),
                    avatar  = r.avatar_url,
                    rank    = r.rank,
                    level   = r.level or 1,
                    irating = r.i_rating,
                    sr      = r.sr,
                    points  = r.alltime_points or 0,
                    races   = tonumber(r.races) or 0,
                    wins    = tonumber(r.wins) or 0,
                    owner   = r.id == crew.owner_id,
                }
            end
            out.roster = roster

            local ownerName = MySQL.scalar.await(
                "SELECT username FROM players WHERE id = ? LIMIT 1", { crew.owner_id })
            out.crew.owner = ownerName

            if out.crew.isOwner then out.outgoing = outgoingInvites(crew.id) end
        end
    end
    return out
end)

lib.callback.register("spz-crew:list", function()
    local rows = MySQL.query.await([[
        SELECT c.id, c.name, c.tag, c.owner_id, c.image_url, c.created_at,
               c.description, c.colour, c.recruiting,
               o.username             AS owner,
               o.avatar_url           AS owner_avatar,
               o.rank                 AS owner_rank,
               COUNT(p.id)                 AS members,
               AVG(NULLIF(p.i_rating, 0))  AS avg_irating,
               AVG(NULLIF(p.sr, 0))        AS avg_sr,
               SUM(p.alltime_points)       AS points,
               SUM(p.top3_count)           AS podiums,
               MAX(p.i_rating)             AS top_irating,
               SUM(CASE WHEN p.last_race_at > (UNIX_TIMESTAMP() - 604800) THEN 1 ELSE 0 END) AS active_week
        FROM crews c
        LEFT JOIN players p ON p.crew_id = c.id
        LEFT JOIN players o ON o.id = c.owner_id
        GROUP BY c.id
        ORDER BY members DESC, points DESC, c.name ASC
        LIMIT 100
    ]])

    local out = {}
    for _, r in ipairs(rows or {}) do
        out[#out + 1] = {
            id           = r.id,
            name         = r.name,
            tag          = r.tag,
            owner_id     = r.owner_id,
            owner        = r.owner,
            owner_avatar = r.owner_avatar,
            owner_rank   = r.owner_rank,
            image        = r.image_url,
            description  = r.description,
            colour       = r.colour,
            recruiting   = (r.recruiting == nil) or r.recruiting == 1,
            created_at   = r.created_at,
            members      = tonumber(r.members) or 0,
            avg_irating  = math.floor(tonumber(r.avg_irating) or 0),
            points       = tonumber(r.points) or 0,
            -- expanded panel only
            avg_sr       = tonumber(r.avg_sr) or 0,
            podiums      = tonumber(r.podiums) or 0,
            top_irating  = tonumber(r.top_irating) or 0,
            active_week  = tonumber(r.active_week) or 0,
        }
    end
    return out
end)

-- ── Invites ──────────────────────────────────────────────────────────────────

local INVITE_TTL = 7 * 24 * 60 * 60   -- a week

-- Online source for a DB player id, or nil when they're offline.
local function srcOfPid(pid)
    for _, s in ipairs(GetPlayers()) do
        local tp = profile(tonumber(s))
        if tp and tp.id == pid then return tonumber(s) end
    end
    return nil
end

-- Invites waiting on this player, newest first.
function incomingInvites(pid)
    local rows = MySQL.query.await([[
        SELECT i.id, i.created_at, i.expires_at,
               c.id AS crew_id, c.name, c.tag, c.image_url, c.description,
               COUNT(p.id)  AS members,
               b.username   AS invited_by
        FROM crew_invites i
        JOIN crews   c ON c.id = i.crew_id
        JOIN players b ON b.id = i.invited_by
        LEFT JOIN players p ON p.crew_id = c.id
        WHERE i.player_id = ? AND i.status = 'pending'
          AND (i.expires_at IS NULL OR i.expires_at > NOW())
        GROUP BY i.id
        ORDER BY i.created_at DESC
    ]], { pid }) or {}

    local out = {}
    for _, r in ipairs(rows) do
        out[#out + 1] = {
            id = r.id, crew_id = r.crew_id,
            name = r.name, tag = r.tag, image = r.image_url, description = r.description,
            members = tonumber(r.members) or 0,
            invited_by = r.invited_by,
            created_at = r.created_at, expires_at = r.expires_at,
        }
    end
    return out
end

-- Invites this crew has sent that are still waiting.
function outgoingInvites(crewId)
    local rows = MySQL.query.await([[
        SELECT i.id, i.created_at, i.expires_at,
               p.id AS pid, p.username, p.avatar_url, p.i_rating, p.rank
        FROM crew_invites i
        JOIN players p ON p.id = i.player_id
        WHERE i.crew_id = ? AND i.status = 'pending'
          AND (i.expires_at IS NULL OR i.expires_at > NOW())
        ORDER BY i.created_at DESC
    ]], { crewId }) or {}

    local out = {}
    for _, r in ipairs(rows) do
        out[#out + 1] = {
            id = r.id, pid = r.pid, name = r.username, avatar = r.avatar_url,
            irating = r.i_rating, rank = r.rank,
            created_at = r.created_at, expires_at = r.expires_at,
            online = srcOfPid(r.pid) ~= nil,
        }
    end
    return out
end

-- Players currently online who are not in a crew — the invite picker.
lib.callback.register("spz-crew:invitable", function(source)
    local p = profile(source)
    if not p or not p.crew_id then return {} end

    local crew = exports[IDENT]:GetCrew(p.crew_id)
    if not crew or crew.owner_id ~= p.id then return {} end

    local ids = {}
    for _, s in ipairs(GetPlayers()) do
        local tp = profile(tonumber(s))
        if tp and tp.id and not tp.crew_id then ids[#ids + 1] = tp.id end
    end
    if #ids == 0 then return {} end

    local placeholders = string.rep("?,", #ids):sub(1, -2)
    local rows = MySQL.query.await(([[
        SELECT p.id AS pid, p.username, p.avatar_url, p.i_rating, p.rank,
               EXISTS(SELECT 1 FROM crew_invites i
                      WHERE i.player_id = p.id AND i.crew_id = ? AND i.status = 'pending'
                        AND (i.expires_at IS NULL OR i.expires_at > NOW())) AS invited
        FROM players p
        WHERE p.id IN (%s) AND p.banned = 0
        ORDER BY p.username ASC
    ]]):format(placeholders), (function()
        local args = { crew.id }
        for _, id in ipairs(ids) do args[#args + 1] = id end
        return args
    end)()) or {}

    local out = {}
    for _, r in ipairs(rows) do
        out[#out + 1] = {
            pid = r.pid, name = r.username or ("Driver " .. r.pid),
            avatar = r.avatar_url, irating = r.i_rating, rank = r.rank,
            invited = tonumber(r.invited) == 1,
        }
    end
    return out
end)

lib.callback.register("spz-crew:invite", function(source, targetPid)
    targetPid = tonumber(targetPid)
    local p = profile(source)
    if not p or not p.crew_id then return { ok = false, error = "Not in a crew" } end

    local crew = exports[IDENT]:GetCrew(p.crew_id)
    if not crew or crew.owner_id ~= p.id then return { ok = false, error = "Only the owner can invite" } end
    if not targetPid or targetPid == p.id then return { ok = false, error = "Pick another player" } end

    local target = MySQL.single.await(
        "SELECT id, username, crew_id FROM players WHERE id = ? LIMIT 1", { targetPid })
    if not target then return { ok = false, error = "No such player" } end
    if target.crew_id then
        return { ok = false, error = target.crew_id == crew.id and "Already in your crew" or "Already in a crew" }
    end

    local existing = MySQL.scalar.await([[
        SELECT id FROM crew_invites
        WHERE crew_id = ? AND player_id = ? AND status = 'pending'
          AND (expires_at IS NULL OR expires_at > NOW()) LIMIT 1
    ]], { crew.id, targetPid })
    if existing then return { ok = false, error = "They already have a pending invite" } end

    MySQL.insert.await([[
        INSERT INTO crew_invites (crew_id, player_id, invited_by, expires_at)
        VALUES (?, ?, ?, FROM_UNIXTIME(?))
    ]], { crew.id, targetPid, p.id, os.time() + INVITE_TTL })

    local tsrc = srcOfPid(targetPid)
    if tsrc then
        TriggerClientEvent("spz-crew:notify", tsrc,
            ("%s invited you to %s — open /crew to respond"):format(p.username or "A crew owner", crew.name), "info")
    end
    return { ok = true }
end)

-- Owner withdraws an invite the crew sent.
lib.callback.register("spz-crew:cancelInvite", function(source, inviteId)
    inviteId = tonumber(inviteId)
    local p = profile(source)
    if not p or not p.crew_id then return { ok = false, error = "Not in a crew" } end

    local crew = exports[IDENT]:GetCrew(p.crew_id)
    if not crew or crew.owner_id ~= p.id then return { ok = false, error = "Only the owner can cancel invites" } end

    local owned = MySQL.scalar.await(
        "SELECT id FROM crew_invites WHERE id = ? AND crew_id = ? AND status = 'pending' LIMIT 1",
        { inviteId, crew.id })
    if not owned then return { ok = false, error = "Invite not found" } end

    MySQL.update.await(
        "UPDATE crew_invites SET status = 'cancelled', responded_at = NOW() WHERE id = ?", { inviteId })
    return { ok = true }
end)

-- Invitee accepts or declines. Accepting bypasses the recruiting switch, since
-- the crew asked for them, but still goes through JoinCrew for the cooldown and
-- statebag sync.
lib.callback.register("spz-crew:respondInvite", function(source, inviteId, accept)
    inviteId = tonumber(inviteId)
    local p = profile(source)
    if not p then return { ok = false, error = "No profile" } end

    local inv = MySQL.single.await([[
        SELECT id, crew_id FROM crew_invites
        WHERE id = ? AND player_id = ? AND status = 'pending'
          AND (expires_at IS NULL OR expires_at > NOW()) LIMIT 1
    ]], { inviteId, p.id })
    if not inv then return { ok = false, error = "Invite is no longer valid" } end

    if not accept then
        MySQL.update.await(
            "UPDATE crew_invites SET status = 'declined', responded_at = NOW() WHERE id = ?", { inviteId })
        return { ok = true, declined = true }
    end

    if p.crew_id then return { ok = false, error = "Leave your current crew first" } end

    local ok, err = exports[IDENT]:JoinCrew(source, inv.crew_id)
    if not ok then
        if type(err) == "number" then return { ok = false, error = ("On cooldown: %ds"):format(err) } end
        return { ok = false, error = err or "Failed" }
    end

    MySQL.update.await(
        "UPDATE crew_invites SET status = 'accepted', responded_at = NOW() WHERE id = ?", { inviteId })
    -- Any other pending invites for this player are moot now.
    MySQL.update.await(
        "UPDATE crew_invites SET status = 'cancelled', responded_at = NOW() WHERE player_id = ? AND status = 'pending'",
        { p.id })

    local owner = MySQL.scalar.await([[
        SELECT owner_id FROM crews WHERE id = ? LIMIT 1 ]], { inv.crew_id })
    local osrc = owner and srcOfPid(owner)
    if osrc then
        TriggerClientEvent("spz-crew:notify", osrc,
            ("%s accepted your crew invite"):format(p.username or "A driver"), "success")
    end
    return { ok = true }
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
    crewId = tonumber(crewId)

    -- A crew with recruiting switched off is closed to new members.
    local open = MySQL.scalar.await("SELECT recruiting FROM crews WHERE id = ? LIMIT 1", { crewId })
    if open == 0 then return { ok = false, error = "That crew is not recruiting" } end

    local ok, err = exports[IDENT]:JoinCrew(source, crewId)
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

-- ── Settings (owner only) ────────────────────────────────────────────────────

local function trim(s) return (type(s) == "string" and s:gsub("^%s+", ""):gsub("%s+$", "")) or "" end

-- Only https links to an actual image file; empty clears the field.
local function validImage(url)
    if url == "" then return true end
    if #url > 512 then return false, "Image link is too long" end
    if not url:match("^https://[%w%-%._~:/%?#%[%]@!%$&'%(%)%*%+,;=%%]+$") then
        return false, "Image must be an https:// link"
    end
    local low = url:lower()
    if not (low:match("%.png") or low:match("%.jpe?g") or low:match("%.gif") or low:match("%.webp")) then
        return false, "Image link must point at a png, jpg, gif or webp"
    end
    return true
end

-- Owner edits the crew profile. Every field is optional — only the keys present
-- in the payload are written.
lib.callback.register("spz-crew:updateSettings", function(source, fields)
    if type(fields) ~= "table" then return { ok = false, error = "Invalid input" } end

    local p = profile(source)
    if not p or not p.crew_id then return { ok = false, error = "Not in a crew" } end

    local crew = exports[IDENT]:GetCrew(p.crew_id)
    if not crew or crew.owner_id ~= p.id then return { ok = false, error = "Only the owner can edit the crew" } end

    local sets, args = {}, {}

    if fields.name ~= nil then
        local name = trim(fields.name)
        if #name < 3 or #name > 24 then return { ok = false, error = "Name must be 3–24 characters" } end
        local clash = MySQL.scalar.await("SELECT id FROM crews WHERE name = ? AND id <> ? LIMIT 1", { name, crew.id })
        if clash then return { ok = false, error = "That name is taken" } end
        sets[#sets + 1] = "name = ?"; args[#args + 1] = name
    end

    if fields.tag ~= nil then
        local tag = trim(fields.tag):upper():gsub("[^A-Z0-9]", "")
        if #tag < 2 or #tag > 4 then return { ok = false, error = "Tag must be 2–4 letters or digits" } end
        local clash = MySQL.scalar.await("SELECT id FROM crews WHERE tag = ? AND id <> ? LIMIT 1", { tag, crew.id })
        if clash then return { ok = false, error = "That tag is taken" } end
        sets[#sets + 1] = "tag = ?"; args[#args + 1] = tag
    end

    if fields.image ~= nil then
        local url = trim(fields.image)
        local ok, err = validImage(url)
        if not ok then return { ok = false, error = err } end
        sets[#sets + 1] = "image_url = ?"; args[#args + 1] = url ~= "" and url or nil
    end

    if fields.description ~= nil then
        local desc = trim(fields.description)
        if #desc > 160 then return { ok = false, error = "Description must be 160 characters or fewer" } end
        sets[#sets + 1] = "description = ?"; args[#args + 1] = desc ~= "" and desc or nil
    end

    if fields.colour ~= nil then
        local col = trim(fields.colour)
        if col ~= "" and not col:match("^#%x%x%x%x%x%x$") then
            return { ok = false, error = "Colour must be a hex value like #ff6200" }
        end
        sets[#sets + 1] = "colour = ?"; args[#args + 1] = col ~= "" and col or nil
    end

    if fields.recruiting ~= nil then
        sets[#sets + 1] = "recruiting = ?"; args[#args + 1] = fields.recruiting and 1 or 0
    end

    if #sets == 0 then return { ok = false, error = "Nothing to update" } end

    args[#args + 1] = crew.id
    MySQL.update.await(("UPDATE crews SET %s WHERE id = ?"):format(table.concat(sets, ", ")), args)

    -- Tag lives on nametags/statebags, so re-sync every online member.
    if fields.tag ~= nil then
        for _, s in ipairs(GetPlayers()) do
            local tp = profile(tonumber(s))
            if tp and tp.crew_id == crew.id then
                TriggerEvent("SPZ:crewChanged", tonumber(s), crew.id, crew.id)
            end
        end
    end

    return { ok = true }
end)

-- Owner hands the crew to another member and stays on as a regular member.
lib.callback.register("spz-crew:transferOwner", function(source, targetPid)
    targetPid = tonumber(targetPid)
    local p = profile(source)
    if not p or not p.crew_id then return { ok = false, error = "Not in a crew" } end

    local crew = exports[IDENT]:GetCrew(p.crew_id)
    if not crew or crew.owner_id ~= p.id then return { ok = false, error = "Only the owner can transfer" } end
    if not targetPid or targetPid == p.id then return { ok = false, error = "Pick another member" } end

    local isMember = MySQL.scalar.await(
        "SELECT id FROM players WHERE id = ? AND crew_id = ? LIMIT 1", { targetPid, crew.id })
    if not isMember then return { ok = false, error = "That player is not in the crew" } end

    MySQL.update.await("UPDATE crews SET owner_id = ? WHERE id = ?", { targetPid, crew.id })

    for _, s in ipairs(GetPlayers()) do
        local tp = profile(tonumber(s))
        if tp and tp.id == targetPid then
            TriggerClientEvent("spz-crew:notify", tonumber(s), "You are now the crew owner", "success")
            break
        end
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
