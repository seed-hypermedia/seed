WITH RECURSIVE

-- 1) Basic bounds
bounds AS (
  SELECT
    datetime(MIN(createdAt))       AS first_ts,
    datetime('now', '-1 year')     AS one_year_ago,
    datetime('now')                AS now_ts
  FROM emails
),

-- 2) Start from later of (first_ts, one_year_ago)
start_date AS (
  SELECT
    CASE
      WHEN first_ts > one_year_ago THEN first_ts
      ELSE one_year_ago
    END AS start_ts,
    now_ts
  FROM bounds
),

-- 3) Generate week_end timestamps: now, now-7d, now-14d, ...
weeks AS (
  -- first week_end is "now"
  SELECT now_ts AS week_end
  FROM start_date

  UNION ALL

  -- go backwards in 7 day steps until we hit start_ts
  SELECT datetime(week_end, '-7 days')
  FROM weeks, start_date
  WHERE datetime(week_end, '-7 days') >= start_ts
),

-- 4) Metrics per week_end, using ONLY data up to that week_end
weekly_metrics AS (
  SELECT
    week_end,

    -- new users in the last 7 days up to this week_end
    (
      SELECT COUNT(*)
      FROM emails e
      WHERE e.isUnsubscribed = 0
        AND datetime(e.createdAt) >= datetime(week_end, '-7 days')
        AND datetime(e.createdAt) <= week_end
    ) AS new_users,

    -- total active users as of this week_end
    (
      SELECT COUNT(*)
      FROM emails e
      WHERE e.isUnsubscribed = 0
        AND datetime(e.createdAt) <= week_end
    ) AS total_users
  FROM weeks
)

SELECT
  date(week_end) AS date,
  new_users,
  total_users,
  ROUND(
    100.0 * new_users / NULLIF(total_users, 0),
    2
  ) AS growth_percent,
  printf(
    '%.2f%%',
    100.0 * new_users / NULLIF(total_users, 0)
  ) AS growth_label
FROM weekly_metrics
ORDER BY week_end;
