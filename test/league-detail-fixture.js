// A trimmed copy of a real modern league payload: two divisions, two weeks,
// the first played and the second not. Shapes come from GET /api/leagues/:id.
export const LEAGUE = {
  "id": 20,
  "name": "'Morning Guys' League - Fall 2026",
  "start_date": "2026-09-09",
  "status": "active",
  "setup_type": "modern",
  "num_divisions": 2,
  "num_rounds": 1,
  "divisions": [
    {
      "id": 59,
      "league_id": 20,
      "name": "Division 1",
      "level": 1
    },
    {
      "id": 60,
      "league_id": 20,
      "name": "Division 2",
      "level": 2
    }
  ],
  "players": [
    {
      "id": 198,
      "division_id": 59,
      "skill_rank": 1
    },
    {
      "id": 199,
      "division_id": 59,
      "skill_rank": 2
    },
    {
      "id": 200,
      "division_id": 59,
      "skill_rank": 3
    },
    {
      "id": 201,
      "division_id": 59,
      "skill_rank": 4
    },
    {
      "id": 202,
      "division_id": 59,
      "skill_rank": 5
    },
    {
      "id": 203,
      "division_id": 59,
      "skill_rank": 6
    },
    {
      "id": 204,
      "division_id": 59,
      "skill_rank": 7
    },
    {
      "id": 205,
      "division_id": 59,
      "skill_rank": 8
    }
  ],
  "teams": [],
  "courts": [],
  "weeks": [
    {
      "id": 122,
      "league_id": 20,
      "week_number": 1,
      "date": "2026-09-09",
      "byes": [],
      "matchups": [
        {
          "id": 450,
          "week_id": 122,
          "division_id": 59,
          "division_name": "Division 1",
          "division_level": 1,
          "matches": [
            {
              "id": 1733,
              "player1_id": 71,
              "player2_id": 115,
              "player1_score": 3,
              "player2_score": 1,
              "winner_id": 71,
              "court_number": null,
              "match_time": "06:30",
              "skipped": 0,
              "division_id": 59,
              "player1_name": "Michael Szestopalow",
              "player2_name": "Jared Kushner",
              "division_name": "Division 1",
              "division_level": 1,
              "sub1_id": null,
              "sub1_name": null,
              "sub2_id": null,
              "sub2_name": null
            },
            {
              "id": 1734,
              "player1_id": 114,
              "player2_id": 116,
              "player1_score": 3,
              "player2_score": 2,
              "winner_id": 114,
              "court_number": null,
              "match_time": "06:30",
              "skipped": 0,
              "division_id": 59,
              "player1_name": "Sam Steyn",
              "player2_name": "Alex Hupé",
              "division_name": "Division 1",
              "division_level": 1,
              "sub1_id": null,
              "sub1_name": null,
              "sub2_id": null,
              "sub2_name": null
            },
            {
              "id": 1735,
              "player1_id": 106,
              "player2_id": 121,
              "player1_score": 3,
              "player2_score": 1,
              "winner_id": 106,
              "court_number": null,
              "match_time": "06:30",
              "skipped": 0,
              "division_id": 59,
              "player1_name": "Michael Reaume",
              "player2_name": "Mike Brown",
              "division_name": "Division 1",
              "division_level": 1,
              "sub1_id": null,
              "sub1_name": null,
              "sub2_id": null,
              "sub2_name": null
            }
          ]
        }
      ]
    },
    {
      "id": 123,
      "league_id": 20,
      "week_number": 2,
      "date": "2026-09-16",
      "byes": [],
      "matchups": [
        {
          "id": 452,
          "week_id": 123,
          "division_id": 59,
          "division_name": "Division 1",
          "division_level": 1,
          "matches": [
            {
              "id": 1745,
              "player1_id": 71,
              "player2_id": 121,
              "player1_score": null,
              "player2_score": null,
              "winner_id": null,
              "court_number": null,
              "match_time": "06:30",
              "skipped": 0,
              "division_id": 59,
              "player1_name": "Michael Szestopalow",
              "player2_name": "Mike Brown",
              "division_name": "Division 1",
              "division_level": 1,
              "sub1_id": null,
              "sub1_name": null,
              "sub2_id": null,
              "sub2_name": null
            },
            {
              "id": 1748,
              "player1_id": 111,
              "player2_id": 116,
              "player1_score": null,
              "player2_score": null,
              "winner_id": null,
              "court_number": null,
              "match_time": "07:15",
              "skipped": 0,
              "division_id": 59,
              "player1_name": "Ed Dale",
              "player2_name": "Alex Hupé",
              "division_name": "Division 1",
              "division_level": 1,
              "sub1_id": null,
              "sub1_name": null,
              "sub2_id": null,
              "sub2_name": null
            },
            {
              "id": 1750,
              "player1_id": 106,
              "player2_id": 117,
              "player1_score": null,
              "player2_score": null,
              "winner_id": null,
              "court_number": null,
              "match_time": "07:15",
              "skipped": 0,
              "division_id": 59,
              "player1_name": "Michael Reaume",
              "player2_name": "Alec Hutfluss",
              "division_name": "Division 1",
              "division_level": 1,
              "sub1_id": null,
              "sub1_name": null,
              "sub2_id": null,
              "sub2_name": null
            }
          ]
        }
      ]
    }
  ]
};
