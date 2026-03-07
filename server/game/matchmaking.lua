-- KEYS[1]: The queue key (e.g., "matchmaking:10+0")
-- ARGV[1]: User ID connecting
-- ARGV[2]: User Rating
-- ARGV[3]: Rating Range (e.g., 200)

local queue_key = KEYS[1]
local user_id = ARGV[1]
local rating = tonumber(ARGV[2])
local range = tonumber(ARGV[3])

local min_rating = rating - range
local max_rating = rating + range

-- Find all users within the rating range instantly using ZRANGEBYSCORE
local potential_opponents = redis.call('ZRANGEBYSCORE', queue_key, min_rating, max_rating)

for i, opp_id in ipairs(potential_opponents) do
    if opp_id ~= user_id then
        -- Match found! Atomically remove opponent from queue
        redis.call('ZREM', queue_key, opp_id)
        
        -- Also remove the opponent's timestamp
        redis.call('HDEL', queue_key .. ':times', opp_id)
        
        return opp_id -- Return matched user ID directly to Python
    end
end

-- No match found. Add self to the Sorted Set with Rating as the score
redis.call('ZADD', queue_key, rating, user_id)

-- Store timestamp in a separate hash to handle 30-second timeouts easily
redis.call('HSET', queue_key .. ':times', user_id, redis.call('TIME')[1])

return nil -- Indicates user was added to queue