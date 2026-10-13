import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Typography from '@mui/material/Typography'
import { cardImageDataUrl } from '../api/cardImages'
import type { FlashCardFields } from '../api/flashCards'
import type { CardPicture } from '../hooks/useCardPicture'

// How big a picture is shown in a form and the list.
export const thumbnailSize = 96

// A card's picture in a form: the one it has, with a button to take it off, and a button that asks the API for
// one of the card's words. A generated picture is shown for the user to look at, and goes on the card when it's
// saved unless they discard it.
export function PictureField({
  picture,
  fields,
  busy,
  size,
}: {
  picture: CardPicture
  fields: Pick<FlashCardFields, 'spanish' | 'english'>
  busy: boolean
  size?: 'small'
}) {
  const hasWords = fields.spanish.trim() !== '' || fields.english.trim() !== ''
  const buttonProps = { type: 'button', variant: 'outlined', size } as const

  return (
    <Box
      sx={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 1,
      }}
    >
      {picture.current !== null && (
        <>
          <Box
            component="img"
            src={picture.current}
            alt="The card's picture"
            sx={{
              width: thumbnailSize,
              height: thumbnailSize,
              objectFit: 'cover',
              borderRadius: 1,
            }}
          />
          <Button
            {...buttonProps}
            disabled={busy}
            onClick={() => picture.remove()}
          >
            Remove picture
          </Button>
        </>
      )}
      {picture.generated !== null && (
        <>
          <Box
            component="img"
            src={cardImageDataUrl(picture.generated)}
            alt="Generated picture"
            sx={{
              width: thumbnailSize,
              height: thumbnailSize,
              objectFit: 'cover',
              borderRadius: 1,
            }}
          />
          <Button
            {...buttonProps}
            disabled={busy}
            onClick={() => picture.discard()}
          >
            Discard
          </Button>
        </>
      )}
      <Button
        {...buttonProps}
        disabled={busy || picture.generating || !hasWords}
        onClick={() => void picture.generate(fields)}
      >
        {picture.generated !== null || picture.current !== null
          ? 'Generate another picture'
          : 'Generate picture'}
      </Button>
      {picture.generating && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <CircularProgress size={20} aria-label="Generating picture" />
          <Typography variant="body2" color="text.secondary">
            Generating picture…
          </Typography>
        </Box>
      )}
      {picture.errorMessage && (
        <Typography variant="body2" color="error">
          {picture.errorMessage}
        </Typography>
      )}
    </Box>
  )
}
