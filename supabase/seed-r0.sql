-- ============================================================
-- LOMAF HQ — R0 Seed Data (Pre-Season PWRNKGs)
-- Run this AFTER migration.sql
-- ============================================================

-- Insert the R0 round
INSERT INTO pwrnkgs_rounds (round_number, theme, preview_text, week_ahead_text, status, published_at)
VALUES (
  0,
  'The Gap',
  E'R0 PWNRKGs 👀\nI know I said I wouldn''t do PWRNKGs as a silent protest against the R0 nonsense. But then the commissioner played at my heartstrings. He praised my algorithm in public, highlighting that after Round 1 in 2025, the PWRNKGs algo picked 5 out of 6 of the finalists. Pretty impressive. Props to our commissioner…he is very astute - he doesn''t play the ball, he plays the man. Well done 👏\nSo how could I resist? I simply can''t resist. Globalize the intifada, because PWRNKGs are back. Not for (Ned) long…I''ll go on a hiatus during the bye rounds spreadsheet voodoo. But then I''ll be back bigger than ever, with a statement to the VibeCoder hobbyist on what a true app looks like.\nI just had to get my early round tips in to prove that the PWRNKGs brand and algorithm is only getting bigger and better every year.\nSo here it goes…',
  '',
  'published',
  now()
);

-- Get the round ID for FK references
DO $$
DECLARE
  r0_id UUID;
BEGIN
  SELECT id INTO r0_id FROM pwrnkgs_rounds WHERE round_number = 0;

  -- #1 Mansion Mambas
  INSERT INTO pwrnkgs_rankings (round_id, round_number, team_id, team_name, ranking, previous_ranking, writeup)
  VALUES (r0_id, 0, 3194002, 'Mansion Mambas', 1, NULL,
    E'The reigning champ is my favourite for LOMAF 2026 – I''ve penciled him in to go back to back. The earlier draft this year benefited the preparers, and Mansion is the ultimate professional.\n\nThe Gap – It was meant to be his defense, but so far Wilkie and Houston look the goods. Along with nailing the Brad Hill and Riccardi picks, he looks like he could have won the draft with his picks in the 100s.');

  -- #2 South Tel Aviv Dragons
  INSERT INTO pwrnkgs_rankings (round_id, round_number, team_id, team_name, ranking, previous_ranking, writeup)
  VALUES (r0_id, 0, 3194005, 'South Tel Aviv Dragons', 2, NULL,
    E'He''ll feel like he''s just landed at a South American airport… this altitude is unfamiliar, and he''s getting dizzy. Easily the highest this coach has ever featured on the PWRNKGs.\n\nThe Gap – The list is excellent, but the gap is the coach. The retirement reversal seems to have reinvented the veteran, but how long can it last until he returns to the days of complaining that his RFA, who got 120 last week, surprisingly reverted to their average of 35 one week later. After picking up Jacob Van Rooyen, it seems that the answer to that question is "not very long".');

  -- #3 I believe in SEANO
  INSERT INTO pwrnkgs_rankings (round_id, round_number, team_id, team_name, ranking, previous_ranking, writeup)
  VALUES (r0_id, 0, 3194009, 'I believe in SEANO', 3, NULL,
    E'The tag team''s side looked as shaky as Coby''s left knee at first glance, but almost all of the speculative picks look like they''re paying off. Budarick, Redman, Jeffrey, Robertson and Ginnivan all look like they could be genuine premiums. Funnily enough, it''s the Messiah Nasiah who is currently the only underperformer in the team.\n\nThe Gap – Is there enough firepower in a midfield of Brayshaw, Heeney, Kennedy, Oliver Cerra? It''s certainly deep – but winning LOMAF sides usually have at least 3 x 100+ mids. Do they have any?');

  -- #4 Littl' bit LIPI
  INSERT INTO pwrnkgs_rankings (round_id, round_number, team_id, team_name, ranking, previous_ranking, writeup)
  VALUES (r0_id, 0, 3194003, 'Littl'' bit LIPI', 4, NULL,
    E'A horror start for the ex-Commish, but it was to be expected with the short-term unavailability of 4 of his first 12 picks. The R10 Luke Ryan pick will certainly come back to haunt him, but the rest of the list looks solid. The M4&5 Jagga and Tana combo will be the point of difference for him all year.\n\nThe Gap – The ruck. Briggs was never going to be 90+, but he''s looking like a genuine <60. Extort him at the trade table. His only solace is that he''s not the only one.');

  -- #5 Melech Mitchito
  INSERT INTO pwrnkgs_rankings (round_id, round_number, team_id, team_name, ranking, previous_ranking, writeup)
  VALUES (r0_id, 0, 3194006, 'Melech Mitchito', 5, NULL,
    E'New year, new job, but the same under-the-radar approach for the reigning Home & Away Champ. Has built a list that will once again contend late into the year. Already got a few promising DPPs on the horizon, but I guess he''ll only discover that in R6.\n\nThe Gap – Can you win a flag with Libba at M2, and Tom Atkins at M4? A typically strong forward line may need to convert into a bolstered midfield at the trade table for Gadi to play a role.');

  -- #6 Cripps Don't Lie
  INSERT INTO pwrnkgs_rankings (round_id, round_number, team_id, team_name, ranking, previous_ranking, writeup)
  VALUES (r0_id, 0, 3194010, 'Cripps Don''t Lie', 6, NULL,
    E'Could this be the year for Cripps to break his finals drought? He certainly has the list for it, but can he maintain the engagement? A new-and-improved non-bachelor attitude should inspire Penso to take a more sustainable, balanced approach to fantasy this year. We certainly saw that at the list build.\n\nThe Gap – The midfield. Taranto, Cripps, JHF make up his M2-4, all predicted to average in the low 80s. Marshall is his biggest asset at flex, but can he find the right moment to trade him? Or will he live by his company''s mantra, that the best time to sell your stock is never.');

  -- #7 Take Me Home Country Road
  INSERT INTO pwrnkgs_rankings (round_id, round_number, team_id, team_name, ranking, previous_ranking, writeup)
  VALUES (r0_id, 0, 3194008, 'Take Me Home Country Road', 7, NULL,
    E'Jumping out of the blocks with multiple segments and record-high engagement (starting 4 hours after shabbos comes out). Nailed the first half of the draft, but didn''t quite nail the depth players. Other than Grundy, most of his players went overs on the weekend, and he only managed a 1500. But that''s alright – definitely an improvement on last year.\n\nThe Gap – The midfield. Hewett/Neale are great for an M4/5, but he''s got them at M2&3. He''ll need them to each average 95+ to remain a threat for the pointy end of the season. Rowbottom, Nash, Garcia, and Hopper don''t really make an opposition coast tremble.');

  -- #8 Doge Bombers
  INSERT INTO pwrnkgs_rankings (round_id, round_number, team_id, team_name, ranking, previous_ranking, writeup)
  VALUES (r0_id, 0, 3194001, 'Doge Bombers', 8, NULL,
    E'The commissioner might have spent all his coins on commissioning. Not so easy – is it? The algorithm actually had him higher than 8, backing him in to bounce back from a historically unders week, especially in defense. But the Gulden news is demoralizing…could we get a checked out commissioner?\n\nThe Gap – Forward & Ruck. He''s got Reeves and Meek, but unfortunately they can''t combine to take only one spot on the playing list. They''ll raffle off the good scores, or just both be a solid 70 all year. Graham, Freijah, Lalor, De Goey is a forward line that is going to lose him games all year.');

  -- #9 Gun M Down
  INSERT INTO pwrnkgs_rankings (round_id, round_number, team_id, team_name, ranking, previous_ranking, writeup)
  VALUES (r0_id, 0, 3194004, 'Gun M Down', 9, NULL,
    E'No miluim or Australia trip to blame it on this year. Gun M simply showed up over-confident in his AI Agents, and failed to do any damage at the draft. As you''d expect, loaded up early on forward premiums like Petracca and Philippou, but it came at the expense of a shallow list.\n\nThe Gap – Backline & Midfield. M3 Fiorini has a nice ring to it, but that''s where the niceties end. In the defense, Dale and Noble should score the occasional 100, but playing in two of the most talented teams this year, I doubt they''ll average anywhere near there. Windsor, Roberts and Weddle are all capable of a high score, but they''ll let him down frequently. Everyone stacked their defense this year, but Gun M took the opposite approach. Expect aggressive trading.');

  -- #10 Warnered613
  INSERT INTO pwrnkgs_rankings (round_id, round_number, team_id, team_name, ranking, previous_ranking, writeup)
  VALUES (r0_id, 0, 3194007, 'Warnered613', 10, NULL,
    E'Conspiracy theorists will say what they want to say, but the algorithm is 100% objective, and Warnered deserves to be here. What the hell is this list? Even if you add back a Humphries (80) to his R1 score, there''s really not a whole lot he could complain about, and he was nowhere near clearing a 1500.\n\nThe Gap – Forward Line of Jack Ross, Murphy Reid, Tom Sparrow, Bailey Humphrey. Each will score over 60 as often as they score under 60. The midfield is scary, but Harley Reid and Hayden Young may end up being IRL guns who aren''t fantasy pigs. Meanwhile, with Mckercher playing full-time mid, his defense is underwhelming. Worrell and Jiath won''t trouble the scorers too much.');
END $$;
