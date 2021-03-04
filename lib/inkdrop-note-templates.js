'use babel';
const metadataParser = require('markdown-yaml-metadata-parser');
const { Liquid } = require('liquidjs');
const setupTemplates = async () => {
    const db = inkdrop.main.dataStore.getLocalDB()
    const TEMPLATE_NOTEBOOK_NAME = "_Templates";
    const templateBook = await db.books.findWithName(TEMPLATE_NOTEBOOK_NAME);
    if (!templateBook) {
        console.log(`Not found ${TEMPLATE_NOTEBOOK_NAME} notebook`)
        return [];
    }
    const { docs } = await db.notes.findInBook(templateBook._id);
    if (!docs) {
        console.log(`Not found docs in ${TEMPLATE_NOTEBOOK_NAME}`);
        return [];
    }
    const promises = docs.map(async doc => {
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
