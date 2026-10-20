import "../foundations.css";
import "./link.css";

export interface LinkProps {
  /** A web address or a file. For an action inside the app, use <Button variant="link">. */
  href: string;
  /** Says where it goes: "the Claude Code docs", never "here". */
  children: string;
}

export function Link({ href, children }: LinkProps) {
  return <a className="av-link" href={href}>{children}</a>;
}
