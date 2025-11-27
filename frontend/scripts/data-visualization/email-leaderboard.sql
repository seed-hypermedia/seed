WITH leaderboard AS (
  SELECT
    id,
    COUNT(DISTINCT email) AS subscriber_count,
    100.0 * COUNT(DISTINCT email) / NULLIF(
      (SELECT COUNT(DISTINCT email) FROM email_subscriptions),
      0
    ) AS subscriber_pct_value
  FROM email_subscriptions
  GROUP BY id
)
SELECT
  id,
  subscriber_count,
  ROUND(subscriber_pct_value, 2) AS subscriber_pct_numeric,
  printf('%.2f%%', subscriber_pct_value) AS subscriber_pct_label
FROM leaderboard
ORDER BY subscriber_count DESC;