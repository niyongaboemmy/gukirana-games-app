# Boxer v9 first real-scan test (P3-FGT-23): verdict and review images

**Verdict: this boxer does NOT beat the v8 boxer. It is not a candidate.** These images record a pipeline test and
its defects. Nothing here goes into the game.

Rendered in the dev-only boxer lab (`/play/boxing-lab?mode=boxer&v9=scan&...`) from the git-ignored test build.
Credits: [CREDITS.md](CREDITS.md).

| File                                | Shot                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------- |
| side-by-side-v8-vs-v9scan-guard.jpg | v8 (left) and the v9 scan boxer (right), guard, same lab camera and light |
| guard.jpg, jab.jpg, lead-hook.jpg   | v9 scan boxer, CMU motion, cloth correctives on                           |
| hit-lean-back-standin.jpg           | the hit-reaction stand-in (CMU has no hit reactions)                      |
| face.jpg                            | face close-up, 3/4                                                        |
| armhole-lead-hook.jpg               | armhole close-up from behind, lead hook                                   |
| singlet-edge-closeup-jab.jpg        | singlet edge close-up, jab                                                |

## Side by side against v8 (judged at full size)

Better than v8:

- the body: real anatomy and proportions from a real person, real muscle shape in the legs, arms and back;
- the garments are smooth: no lumps, the arms stay outside the singlet in every pose, no tears.

Worse than v8 (why it loses):

- **face**: mushy and faceted at close range: the face gets about 5k triangles and a small share of a 2k atlas, and
  the scan's baked studio lighting is in the skin colour;
- **gloves**: primitive placeholder blobs (v8 has modelled gloves with cuffs and white targets);
- **no boots, no headgear**: barefoot;
- **armpit**: the flex-pose scan never saw the armpits; re-posed, they show a pale, torn-looking patch when the arm is
  raised (armhole close-up);
- **singlet edges**: the neckline is slightly scalloped and the side edge under a raised arm is stepped (singlet close-up);
- the motion is amateur CMU shadow-boxing: the rear glove sits on the face in the guard (no runtime keep-out yet).

Overall: v8 wins at the same camera and light. The scan body is the one part that reads more real.
