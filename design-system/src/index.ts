// playwsrc-ui: the Play WSRC app's component vocabulary as React components,
// for Claude Design. Each one renders the exact markup and class names the
// app's pages build by hand, so a design converts straight back into the
// app's template strings. Styling is renderer/styles.css itself.
export { AppShell, type AppShellProps, type AppPage } from './AppShell';
export { Avatar, avatarColor, playerInitials, type AvatarProps } from './Avatar';
export { Bracket, type BracketProps, type BracketRound } from './Bracket';
export { BracketMatch, type BracketMatchProps } from './BracketMatch';
export { Button, type ButtonProps, type ButtonVariant } from './Button';
export { Checkbox, type CheckboxProps } from './Checkbox';
export { Chip, type ChipProps } from './Chip';
export { EmptyState, type EmptyStateProps } from './EmptyState';
export { FormActions, type FormActionsProps } from './FormActions';
export { FormField, type FormFieldProps } from './FormField';
export { GroupCard, type GroupCardProps, type GroupStanding, type GroupMatch } from './GroupCard';
export { Icon, type IconName, type IconProps } from './Icon';
export { Input, type InputProps } from './Input';
export { LeagueCard, type LeagueCardProps, type LeagueCardMeta } from './LeagueCard';
export { MatchCard, type MatchCardProps, type MatchCardPlayer, type MatchCardMeeting } from './MatchCard';
export { Modal, type ModalProps } from './Modal';
export { Pill, type PillProps, type PillColor } from './Pill';
export { ScorePicker, type ScorePickerProps, type MatchScore } from './ScorePicker';
export { SearchInput, type SearchInputProps } from './SearchInput';
export { SectionLabel, type SectionLabelProps } from './SectionLabel';
export { Select, type SelectProps } from './Select';
export { StatusBadge, type StatusBadgeProps } from './StatusBadge';
export { TableCard, type TableCardProps } from './TableCard';
export { Tabs, type TabsProps, type TabItem } from './Tabs';
export { Textarea, type TextareaProps } from './Textarea';
export { Toast, type ToastProps } from './Toast';
export { WizardSteps, type WizardStepsProps } from './WizardSteps';
