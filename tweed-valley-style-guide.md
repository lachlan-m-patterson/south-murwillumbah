# Tweed Valley atlas
## Shared style guide for ArcGIS StoryMaps, ArcGIS Online and Three.js

Use this guide when restyling a map in the Murwillumbah flood story. The reader moves from catchment to town to street. Carry the same river, place names, typography and symbols through that change of scale. Before styling a scene, finish this sentence in plain English: “From this view the reader can see ___.” Give that relationship the highest visual priority. Preserve supplied geometry, classifications, units, credits and evidence status. Flag missing metadata for the author.

## Visual language

| Role | Colour | Application |
|---|---|---|
| Page and narrative | White #FFFFFF | Continue the StoryMap page into sidecars, pop-ups and captions. |
| Map surround | Pale eucalyptus #E9EDE4 | Empty space around 3D terrain and the background for map tools. |
| Heading and body | Ink #102B29, slate #405454 | Near-black headings, grey serif prose on white. Match the existing StoryMap fonts first. |
| Actions | Forest #285843 | White text on the primary action. Give the selected control a check or underline. |
| Opening scene | Deep estuary #102628, pale leaf #C2DBB5 | Dark surround and a single pale action for the valley introduction. |
| Land and buildings | Sage #A5B198, limestone #ECE9DF | Muted relief, matte roofs and soft shadows. Retain natural imagery where it helps identify a site. |
| Permanent river | River teal #397B80 | Trace the main channel through the valley and town. Use a lighter teal #87BEC0 on dark terrain. |
| Flood depth | #DCEFEA → #A6D5CD → #65ADA9 → #277A80 → #124C59 | Light to dark with increasing depth. Use the source breaks or continuous scale, units in metres and the same range in comparable views. The five stops are colours, not proposed thresholds. |
| Human evidence | Clay #AD5135 | White-rimmed diamonds for surveyed homes. Rain gauges use circles, with area proportional to rainfall if magnitude is encoded. Give each symbol its own legend entry. |

On the opening terrain, let the coastline, valley relief and highlighted town carry the composition. On analytical maps, use a quiet warm-grey base. Where permanent water and floodwater meet, distinguish the channel with a bank line or direct river label. Show extent alone with a thin teal boundary and a light translucent fill. Give missing or unassessed coverage its own legend treatment wherever it could be read as dry. Use categorical hues of similar visual weight for named subcatchments and retain published zoning colours where readers need to match a planning legend.

## Type and layout

- Match the host heading and body families. If unavailable, use Source Sans 3 or Arial for headings, controls, labels and numbers, and Georgia for narrative and captions. Use the nearest supported sans in the web map.
- Use a bold sentence-case map heading, typically 24–32 CSS px, with 16–18 px serif narrative and 14–16 px controls. Reserve larger editorial serif or italic type for a short phrase in the opening or a major geographic name. Use tabular numerals for a changing gauge value.
- Use one white panel, 16–24 px padding, a fine grey-green border and 4–6 px corners. On desktop, keep prose beside the geography where feasible. On a phone, stack the story and map and collapse secondary controls. Keep attribution visible.
- Direct-label the places the prose names. Start with the Tweed River and Murwillumbah for orientation, then reveal local labels with scale. Use a fine halo over imagery. Label selected landmarks individually and reserve boxed labels for selection or a critical annotation.

## Scene recipes

| Scene | Opening view and reader action |
|---|---|
| Valley introduction · Three.js | Keep the dark relief, strong silhouette and coast → valley → town sequence. Highlight Murwillumbah. Use “Enter the valley” to move closer while keeping the lower Tweed in frame. |
| South Murwillumbah · Three.js | Use the pale surround, natural aerial texture and a bridge as a common landmark. Offer one guided flyover. Selecting the bridge, levee or a street locates and describes it. Group optional zoning and surface settings under Layers. |
| Rain on the rim · ArcGIS Online | Use subdued hillshade, fine tributaries and a slightly heavier main channel. Reveal subcatchments, gauge totals and downstream confluences in the order the prose explains them. Include the rainfall accumulation period alongside mm. |
| 2022 flood · Three.js | Keep the pale buildings, gauge history and one large level reading. Link time selection to the chart and scene. Label the dated sequence “2022 flood reconstruction”. Show gauge level and its verified datum separately from local depth above ground. Mark interpolated timing or modelled values beside the readout. |
| Street by street · ArcGIS Online | Begin on a light street map with clay diamonds, a labelled River Street and the river bend. Keep points fixed as the reader reveals flood depth underneath. Offer aerial imagery for closer inspection. Keep the same extent between the survey and depth views so the reader can compare individual streets. |

For the street map, update any prose that refers to “cyan dots” or “the blue beneath the dots”. A colour-independent key is “Each diamond marks a home identified in the street survey.” Preserve the survey's actual definition of “identified”. Use a single point per mapped home. Keep point size constant at a given zoom and check dense groups at the opening scale.

## Apply in each platform

**Three.js.** Apply shared colours through named material and interface settings. Check the lit result beside the ArcGIS map because lighting changes how a hex colour appears. Use matte buildings, restrained relief and a neutral surround. Provide a reset view, a top view where comparison matters and a reduced-motion route through flyovers. Display vertical exaggeration when used.

**ArcGIS Online.** Set the basemap, layer order, symbol colours, scale-dependent labels and feature pop-ups in the web map. Use saved story views for changes in visibility and extent. Draw terrain first, then thematic surfaces, then linework, survey symbols and priority labels. Use a relevant scale bar for street distances. Match native controls as closely as the host permits.

**Evidence and accessibility.** Give every interactive story feature a human-readable title and description. A pop-up should identify the place, explain why it matters, and give the relevant value, unit, date and source where available. Distinguish field or imagery observations, model outputs and confirmed administrative records. Caption each figure with a number, a spatial takeaway and a source. Supply a labelled still for the PDF so its main finding survives without interaction. In the embed, check text over the actual terrain at desktop and phone widths, keyboard access, visible focus, and whether symbols remain distinguishable in greyscale.

## Acceptance check for the implementing LLM

Review the opening frame beside the white StoryMap page. Can a first-time reader locate the place, identify the main pattern and explain the legend before opening a menu? Does the reader action reveal something spatial? Check the opening and selected states for label collisions, legible units, matching symbols in prose and legend, and visible attribution. Preserve existing source information; ask for evidence before adding numerical breaks, observation dates or causal claims.
