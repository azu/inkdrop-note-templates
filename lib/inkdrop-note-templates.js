'use babel';
const metadataParser = require('markdown-yaml-metadata-parser');
const { Liquid } = require('liquidjs');
const setupTemplates = async () => {
    const db = inkdrop.main.dataStore.getLocalDB()
    const TEMPLATE_NOTEBOOK_NAME = "_Templates";
    const TEMPLATE_TAG_NAME = "Template";

    let templateNotes = Array();
    // find notes in _Templates notebook.
    const templateBook = await db.books.findWithName(TEMPLATE_NOTEBOOK_NAME);
    if (templateBook) {
        const notesInBook = await db.notes.findInBook(templateBook._id);
        templateNotes = templateNotes.concat(notesInBook.docs);
    }
    // find notes with Template tag.
    const templateTag = await db.tags.findWithName(TEMPLATE_TAG_NAME);
    if (templateTag) {
        const notesWithTag = await db.notes.findWithTag(templateTag._id);
        templateNotes = templateNotes.concat(notesWithTag.docs);
    }

    if (!templateNotes) {
        console.log(`No note is found in ${TEMPLATE_NOTEBOOK_NAME} notebook or any note with ${TEMPLATE_TAG_NAME} tag.`);
        return [];
    }

    console.log(templateNotes);

    const promises = templateNotes.map(async doc => {
        const { metadata, content } = metadataParser(doc.body);
        if (!metadata) {
            throw new Error("metadata should bw written as yaml front matter");
        }
        if (!metadata.id) {
            throw new Error("metadata should have id property");
        }
        if (!metadata.label && !metadata.title) {
            throw new Error("metadata should have label or title at least one");
        }
        if (!content) {
            throw new Error("template content is missing");
        }
        const engine = new Liquid();
        const now = new Date();
        const title = await engine
            .parseAndRender(metadata.title, {
                ...metadata,
                now
            })
        const body = await engine
            .parseAndRender(content.trim(), {
                ...metadata,
                title,
                now
            })
        return {
            id: metadata.id,
            label: metadata.label || metadata.title,
            title: title,
            body: body,
            doc
        }
    });
    return Promise.all(promises);
}
module.exports = {

    async activate() {
        const templates = await setupTemplates();
        // on
        const db = inkdrop.main.dataStore.getLocalDB()
        const createNoteFromTemplate = async (templateId) => {
            // re-get templates for updating current time
            const currentTemplates = await setupTemplates()
            const template = currentTemplates.find(template => template.id === templateId);
            if (!template) {
                console.error("Can Not found template: " + templateId)
                return;
            }
            console.log("create note from template: ", templateId);
            const state = inkdrop.store.getState();
            const queryContext = state.queryContext;
            const currentBookId = queryContext.mode === "all"
                ? state.config.core.defaultBook
                : queryContext.bookId;
            const note = {
                ...template.doc,
                _id: db.notes.createId(),
                bookId: currentBookId,
                _rev: undefined,
                title: template.title,
                body: template.body,
                createdAt: +new Date(),
                updatedAt: +new Date(),
            }
            // remove Template tag from new note if any.
            for (let tagIndex = note.tags.length - 1; tagIndex >= 0; tagIndex--) {
                const tag = await db.tags.get(note.tags[tagIndex])
                if (tag.name === "Template") {
                    note.tags.splice(tagIndex, 1);
                }
            }
            console.log("new note", note);
            await db.notes.put(note)
            inkdrop.commands.dispatch(document.body, "core:open-note", {
                noteId: note._id,
            })
            inkdrop.commands.dispatch(document.body, "editor:focus-mde")
        }
        templates.forEach(template => {
            inkdrop.commands.add(document.body, `inkdrop-note-templates:${template.id}`, () => {
                createNoteFromTemplate(template.id).catch(error => {
                    console.error(error)
                });
            });
        })
        // add menu
        inkdrop.menu.add([
            {
                label: "File",
                submenu: [
                    {
                        label: "Templates",
                        submenu: templates.reverse().map(template => {
                            return {
                                label: template.label,
                                command: `inkdrop-note-templates:${template.id}`,
                            }
                        }),
                    },
                ],
            },
        ]);
    },

    deactivate() {
    }

};
