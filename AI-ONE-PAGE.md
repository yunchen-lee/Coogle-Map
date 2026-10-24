> **Note:** This document was summarized and drafted with AI assistance based on my project files, design notes, and development records. I reviewed and approved the final text.

# Coogle Maps: Design and Development Process

## Concept and design

I began by searching NYC Open Data for information about pigeons. The available records were 311 complaints about pigeon droppings and odor. This led me to ask why pigeons gather in particular places and what those places might look like from a pigeon's point of view.

I researched urban pigeon behavior and learned that pigeons often search for food near restaurants and pedestrians, rest on building ledges, use parks and water, move in flocks, and return to familiar locations. I developed *Coogle Maps* from this research: human complaints become fictional reviews written from the pigeons' point of view.

I wrote a design document describing the concept, interaction, visual direction, data sources, pigeon behavior, and review system. I combined the 311 complaints with data about restaurants, litter baskets, parks, buildings, public places, cafés, benches, and fountains. I chose an abstract point-cloud map to make the pigeons stand out, using [*Watercolor Style Sketching with Point Cloud*](https://sketchfab.com/3d-models/watercolor-style-sketching-with-point-cloud-6949373156ac4509819f10166b77b91f) as a visual reference.

## Prototype and implementation

I first built a simple p5.js prototype and prepared a Mapbox screenshot and an earlier p5.js/OpenStreetMap example. The prototype tested the basic point-cloud appearance and mouse interaction. I then used Claude Code to revise this prototype and implement most of the remaining technical details from my design instructions and feedback. Approximately 90% of the final code was produced through this AI-assisted coding process.

I used Mapbox Streets v8 as the geographic source after comparing it with LiDAR and 3D mesh options. Its vector tiles contain geographic geometry and metadata rather than finished map images. Parks, water, and buildings are polygons, while roads are mainly lines. The point-cloud builder samples a regular grid over Manhattan every 25 meters and checks which polygon contains each point. It also uses building-height data and samples road points directly along each line. WebGL renders the resulting point cloud.

I used repeated browser tests to adjust the camera, navigation, colors, point sizes, transparency, building height, pigeon distribution, labels, and sound. Each pigeon alternates between random walking and resting periods. A sine function produces separate forward steps and lifts the body, while a home position keeps the pigeon near the complaint location it represents. Six possible layers of one pigeon recording make areas near landmarks sound fuller than quiet streets. Small black pins show familiar tourist landmarks, while colored pins identify the twenty largest complaint hotspots with pigeon explanations that I wrote.

## Review-generation system

I created the `pigeon-map-comment-writer` Codex skill to generate the reviews as a consistent system rather than prompting each one separately. Version v8 specifies natural B1-B2 English, one short sentence, a ` -- Name` signature, varied ages, occupations and personalities, limited pigeon sounds, and realistic behavior such as foraging, flocking, nesting, drinking, perching and homing.

The skill connects pigeon behavior to the supplied restaurants, parks, water, benches, buildings, historic districts, seasons, and complaint data. It prevents unsupported places or local conditions from being invented. A review includes a feature ID only when it uses that record, allowing the interface to show the referenced open-data locations. I reviewed the generated text and revised the skill from v2 through v8. GPT-5 generated 3,630 reviews within these rules.

## Use of AI

AI was used as part of the production workflow. I used Claude Code to research technical options, modify the prototype, implement features, process data, and debug the application. I used GPT-5 through my Codex skill to generate the review text. The concept, design document, initial prototype, data selection, visual and interaction direction, writing rules, testing, and final decisions were developed by me.
