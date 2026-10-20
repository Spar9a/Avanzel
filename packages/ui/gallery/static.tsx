// Renders the gallery to plain HTML, for a preview that needs no script but the theme probe.
import { renderToStaticMarkup } from "react-dom/server";
import { Gallery } from "./Gallery.tsx";

export const markup = () => renderToStaticMarkup(<Gallery />);
