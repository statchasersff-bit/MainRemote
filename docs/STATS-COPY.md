# Writing Stats tab copy

The lower half of each player's Stats tab (the sections under the original
stats) writes its own text from the numbers. An analyst can replace any piece
of it by adding the player to
`artifacts/api-server/data/player/stats_copy.json`, keyed by the player's slug
(the part of the URL after `/players/`).

```json
{
  "jacoby-brissett": {
    "prod_lede": "Through Week 3 with the Cardinals. Brissett is completing passes at a high rate but averaging just 5.6 yards per attempt, which is why his fantasy output depends on touchdowns and matchups.",
    "adv_lede": "He gets the ball out fast and short. That keeps his completion rate high but caps his yards per attempt.",
    "adv_fantasy_note": "Brissett is a volume passer, not a big-play passer. His fantasy weeks rise and fall with how many throws he gets.",
    "career_paragraphs": [
      "Brissett has never finished a season as a top-12 fantasy quarterback...",
      "The past two seasons are the best of his career, helped by his connection with [Trey McBride](/nfl/players/trey-mcbride/)..."
    ],
    "updated_date": "2026-09-29",
    "author": "Jane Analyst"
  }
}
```

Every field is optional. Leave one out and the page writes that part itself.

| Field | Replaces |
|---|---|
| `prod_lede` | The line under "{Name} {season} stats" |
| `adv_lede` | The line under "Advanced … stats" |
| `adv_fantasy_note` | The gray box under the advanced cards. It is printed after "What it means for fantasy:" |
| `career_paragraphs` | The analysis under "What his career numbers say". One to three paragraphs. The Redraft Command link paragraph always follows yours |
| `updated_date` | The byline date, as `YYYY-MM-DD` |
| `author` | The byline name. Without it the byline says "the StatChasers staff" |

Rules:

- Plain text only. A link is `[words](url)`, and the URL must start with
  `https://`, `http://` or `/`. Nothing else (bold, HTML) is interpreted; it
  prints as typed.
- The numbers on the page update weekly and your text does not. Write things
  that stay true, or update `updated_date` when you revise it.
- After editing, check the file is valid JSON (a missing comma breaks every
  player's copy, and the page falls back to the generated text). The test suite
  checks this: `pnpm test` in `artifacts/api-server`.
- The change goes live on the next deploy.
