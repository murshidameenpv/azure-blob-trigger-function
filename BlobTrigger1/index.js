import { pdf } from "pdf-to-img";
import { BlobServiceClient } from "@azure/storage-blob";
import dotenv from "dotenv";
dotenv.config();

// Constants
const containerName = "processed-invoices";
const blobNamePrefix = "image";
const blobServiceClient = BlobServiceClient.fromConnectionString(
  process.env.BLOB_CONNECTION_STRING
);
const containerClient = blobServiceClient.getContainerClient(containerName);

// PDF Processing
const processPdf = async (pdfBuffer) => {
  try {
    const document = await pdf(pdfBuffer, { scale: 3 });
    return document;
  } catch (error) {
    throw new Error(`Error converting PDF to images: ${error.message}`);
  }
};

//Image size validation
const checkImageSizeLimit = async (images) => {
  for await (const image of images) {
    const imageSizeMB = image.length / (1024 * 1024); // Convert to MB
    if (imageSizeMB > 5) {
      return true; // image size exceeds the limit
    }
  }
  return false; // no image exceeds the limit
};

// Image Uploading
const uploadImagesToBlobStorage = async (images, context) => {
  try {
    // Check if any image exceeds the size limit
    const imageSizeExceeded = await checkImageSizeLimit(images, context);
    if (imageSizeExceeded) {
      throw new Error(
        "At least one image exceeds the size limit (5 MB). Uploading cancelled."
      );
    }
    // If no image exceeds the limit, upload all images
        const imageUrls = [];
        let index = 0;
    for await (const image of images) {
      const uniqueBlobName = `${blobNamePrefix}-page${index}-${Date.now()}.png`;
      const blockBlobClient =
        containerClient.getBlockBlobClient(uniqueBlobName);
      await blockBlobClient.uploadData(image, {
        blobHTTPHeaders: { blobContentType: "image/png" },
      });
      imageUrls.push(blockBlobClient.url);
      index++;
    }
    return { imageUrls };
  } catch (error) {
    return { error: error.message };
  }
};

//  Azure Function Entry Point
export default async function (context, myBlob) {
  try {
    // Validate if the uploaded file is a PDF
    if (context.bindingData.properties.contentType !== "application/pdf") {
      context.log("Invalid file format. Only PDF files are accepted.");
      return;
    }

    const images = await processPdf(context.bindings.myBlob);
    const result = await uploadImagesToBlobStorage(images);
    if (result.error) {
      throw new Error(result.error);
    }

    const imageUrls = result.imageUrls;
    context.log.info("Public URLs for uploaded images:");
    imageUrls.forEach((url, index) => {
      context.log(`Image ${index + 1}: ${url}`);
    });
  } catch (error) {
    context.log(`Error processing PDF: ${error.message}`);
  }
}
