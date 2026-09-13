-- Apply to each location database; safe to repeat. No existing rows are changed.
CREATE TABLE IF NOT EXISTS site_metric_daily (
  business TEXT NOT NULL CHECK (business IN ('gigis_long_branch','gigis_sea_bright')),
  day DATE NOT NULL,
  event TEXT NOT NULL CHECK (event IN ('menu_open','category_select','call_click','checkout_start')),
  source TEXT NOT NULL CHECK (source IN ('search','referral','direct','unknown')),
  n INTEGER NOT NULL CHECK (n BETWEEN 1 AND 10000),
  PRIMARY KEY (business, day, event, source)
);
