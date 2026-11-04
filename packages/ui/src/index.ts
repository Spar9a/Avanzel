// @avanzel/ui: the only place in Avanzel that paints. Windows import components from here and
// arrange them; packages/ui/DESIGN.md says which component is for what.

export { Text, type TextProps, type TextVariant, type TextTone } from "./components/Text.tsx";
export { Stack, Row, Spacer, type StackProps, type RowProps } from "./components/Layout.tsx";
export { Button, type ButtonProps, type ButtonVariant, type ButtonSize } from "./components/Button.tsx";
export { Badge, type BadgeProps } from "./components/Badge.tsx";
export { Actions, type ActionsProps } from "./components/Actions.tsx";
export { Switch, type SwitchProps } from "./components/Switch.tsx";
export { Segmented, type SegmentedProps, type SegmentedOption } from "./components/Segmented.tsx";
export { TextField, TextArea, type TextFieldProps, type TextAreaProps } from "./components/TextField.tsx";
export { Kbd, type KbdProps } from "./components/Kbd.tsx";
export { Link, type LinkProps } from "./components/Link.tsx";
export { Icon, ICON_NAMES, type IconName, type IconProps } from "./components/Icon.tsx";
export { Spinner, type SpinnerProps } from "./components/Spinner.tsx";
export { Progress, type ProgressProps } from "./components/Progress.tsx";
export { Hud, type HudProps } from "./components/Hud.tsx";
export { Stage } from "./components/Stage.tsx";
export { Card, type CardProps } from "./components/Card.tsx";
export { Stamp, type StampProps, type StampWord } from "./components/Stamp.tsx";
export { Zel, type ZelProps, type ZelMood, type ZelSize, type ZelLook } from "./components/Zel.tsx";
export { ShelfGlyph, ShelfTag, ShelfMark, SHELF_NAMES, type ShelfTagProps } from "./components/Shelf.tsx";
export { Bubble, type BubbleProps } from "./components/Bubble.tsx";
export { Notice, type NoticeProps } from "./components/Notice.tsx";
export { Group, GroupRow, type GroupProps, type GroupRowProps } from "./components/Group.tsx";
export { ChoiceRow, type ChoiceRowProps } from "./components/ChoiceRow.tsx";
export { ShelfDrawer, type ShelfDrawerProps } from "./components/ShelfDrawer.tsx";
export { Wave } from "./components/Wave.tsx";
export { CapsuleBar, type CapsuleBarProps, type CapsuleMood } from "./patterns/CapsuleBar.tsx";
export { CapsuleNotice, type CapsuleNoticeProps } from "./patterns/CapsuleNotice.tsx";
export { Receipt, type ReceiptPage } from "./patterns/Receipt.tsx";
export { Letter, type LetterProps } from "./patterns/Letter.tsx";
export { PermissionPrimer, type PermissionPrimerProps, type PermissionKind } from "./patterns/PermissionPrimer.tsx";
export { SHELVES, SPACE, type Shelf, type Space } from "./generated/tokens.ts";
