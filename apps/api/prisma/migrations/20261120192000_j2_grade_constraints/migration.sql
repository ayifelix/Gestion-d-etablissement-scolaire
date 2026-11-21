ALTER TABLE "Assessment"
  ADD CONSTRAINT "Assessment_maxScore_positive"
  CHECK ("maxScore" > 0);

ALTER TABLE "StudentMark"
  ADD CONSTRAINT "StudentMark_scale_positive"
  CHECK ("scale" > 0),
  ADD CONSTRAINT "StudentMark_value_within_scale"
  CHECK ("value" IS NULL OR ("value" >= 0 AND "value" <= "scale")),
  ADD CONSTRAINT "StudentMark_status_matches_value"
  CHECK (
    ("status" = 'NOTE' AND "value" IS NOT NULL)
    OR ("status" <> 'NOTE' AND "value" IS NULL)
  );

ALTER TABLE "CalculationRule"
  ADD CONSTRAINT "CalculationRule_weights_valid"
  CHECK (
    "classworkWeight" >= 0
    AND "compositionWeight" >= 0
    AND ("classworkWeight" + "compositionWeight") > 0
    AND "roundingDigits" BETWEEN 0 AND 4
  );
