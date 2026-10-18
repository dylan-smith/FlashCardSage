import { deleteFlashCards } from '../api/flashCards'
import { cardCount } from '../lib/cardCount'
import { trackEvent } from '../telemetry'
import { showToast } from '../toasts'
import { useAction } from './useAction'

// Deletes picked cards, as the cards page and a deck's page do, and says so in a toast with toastKey, so a new one
// replaces the last. onDeleted gets the ids of the cards that went, to take them off the page, and the card being
// edited stops being edited if it's one of them. deleteCards resolves to whether it worked.
export function useDeleteCards({
  setErrorMessage,
  operation,
  toastKey,
  editor,
  onDeleted,
}: {
  setErrorMessage: (message: string) => void
  // Reported with a failure.
  operation: string
  toastKey: string
  editor: { edit: { id: number } | null; cancel: () => void }
  onDeleted: (deleted: Set<number>) => void
}) {
  const action = useAction(setErrorMessage)

  function deleteCards(ids: number[]) {
    return action.run(
      {
        operation,
        fallback: 'Unable to delete the flash cards.',
        reportAll: true,
      },
      async () => {
        await deleteFlashCards(ids)
        trackEvent('FlashCardsDeleted')
        const deleted = new Set(ids)
        onDeleted(deleted)
        if (editor.edit !== null && deleted.has(editor.edit.id)) {
          editor.cancel()
        }
        showToast({
          key: toastKey,
          severity: 'success',
          message: `Deleted ${cardCount(deleted.size)}.`,
        })
      },
    )
  }

  return { busy: action.busy, deleteCards }
}
