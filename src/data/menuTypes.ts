/** Shared menu shapes — hand data and Clover-generated data both conform. */

export type OptionChoice = {
  name: string;
  /** Display upcharge like "+$1.09" — omitted for no-charge choices. */
  delta?: string;
};

export type OptionGroup = {
  group: string;
  /** Human rule, e.g. "Choose 1", "Choose up to 6", "Optional". */
  rule?: string;
  choices: OptionChoice[];
};

export type MenuItem = {
  name: string;
  description?: string;
  price?: string;
  popular?: boolean;
  options?: OptionGroup[];
};

export type MenuCategory = {
  id: string;
  name: string;
  blurb?: string;
  items: MenuItem[];
};
